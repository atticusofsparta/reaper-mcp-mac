--[[
  REAPER MCP Bridge (macOS)
  ------------------------------------------------------------------
  Runs INSIDE REAPER as a persistent deferred ReaScript. Talks to the
  external Node MCP server over file-based IPC in a shared bridge dir.

  Protocol
    request_<id>.json   {"id":N, "func":"Name", "args":[...]}   (written by Node)
    response_<id>.json  {"ok":bool, "ret":<value>, "error":str}  (written here)

  Two dispatch paths:
    * composite commands (names starting with "_") -> curated handlers below,
      which resolve track/item indices internally so the LLM never juggles
      raw pointers.
    * anything else -> generic reaper[func](args...) call, so the full
      ReaScript API is reachable without a handler per function.

  Design notes / hard-won lessons carried from prior bridges:
    * JSON string escaping does backslash FIRST (Windows paths, file URIs).
    * Files are written .tmp then os.rename'd so the reader never sees a
      partially written file (atomic on the same filesystem).
    * userdata pointers returned by ReaScript are stashed in a per-session
      handle registry and surfaced as "handle:N" strings; args of that shape
      are resolved back. Handles are only valid within one REAPER session.
]]--

local SEP = package.config:sub(1, 1)
local bridge_dir = reaper.GetResourcePath() .. '/Scripts/reaper_mcp_bridge_data/'

------------------------------------------------------------------ utils
local function ensure_dir()
  reaper.RecursiveCreateDirectory(bridge_dir, 0)
end

local function read_file(path)
  local f = io.open(path, 'r')
  if not f then return nil end
  local data = f:read('*a')
  f:close()
  return data
end

-- Atomic write: write to a temp file then rename over the target.
local function write_file(path, data)
  local tmp = path .. '.tmp'
  local f = io.open(tmp, 'w')
  if not f then return false end
  f:write(data)
  f:close()
  os.rename(tmp, path)
  return true
end

local function delete_file(path)
  os.remove(path)
end

------------------------------------------------------------------ minimal JSON
local encode_json  -- fwd decl

local function encode_string(s)
  s = s:gsub('\\', '\\\\')   -- MUST be first
       :gsub('"',  '\\"')
       :gsub('\n', '\\n')
       :gsub('\r', '\\r')
       :gsub('\t', '\\t')
  return '"' .. s .. '"'
end

encode_json = function(v)
  local t = type(v)
  if v == nil then
    return 'null'
  elseif t == 'boolean' then
    return tostring(v)
  elseif t == 'number' then
    -- keep integers clean, avoid inf/nan tokens JSON can't parse
    if v ~= v then return 'null' end            -- nan
    if v == math.huge or v == -math.huge then return 'null' end
    if math.type and math.type(v) == 'integer' then return tostring(v) end
    return string.format('%.12g', v)
  elseif t == 'string' then
    return encode_string(v)
  elseif t == 'table' then
    local parts = {}
    if #v > 0 or next(v) == nil then
      for _, item in ipairs(v) do parts[#parts + 1] = encode_json(item) end
      return '[' .. table.concat(parts, ',') .. ']'
    else
      for k, item in pairs(v) do
        parts[#parts + 1] = encode_string(tostring(k)) .. ':' .. encode_json(item)
      end
      return '{' .. table.concat(parts, ',') .. '}'
    end
  else
    return 'null'
  end
end

-- Small recursive-descent JSON decoder (objects, arrays, strings, numbers,
-- true/false/null). Sufficient for the request payloads we send.
local function decode_json(str)
  local pos = 1
  local decode_value

  local function skip_ws()
    local _, e = str:find('^[ \t\r\n]*', pos)
    if e then pos = e + 1 end
  end

  local function decode_string()
    pos = pos + 1 -- opening quote
    local buf = {}
    while pos <= #str do
      local c = str:sub(pos, pos)
      if c == '"' then
        pos = pos + 1
        return table.concat(buf)
      elseif c == '\\' then
        local n = str:sub(pos + 1, pos + 1)
        if n == 'n' then buf[#buf+1] = '\n'
        elseif n == 't' then buf[#buf+1] = '\t'
        elseif n == 'r' then buf[#buf+1] = '\r'
        elseif n == 'b' then buf[#buf+1] = '\b'
        elseif n == 'f' then buf[#buf+1] = '\f'
        elseif n == '/' then buf[#buf+1] = '/'
        elseif n == '"' then buf[#buf+1] = '"'
        elseif n == '\\' then buf[#buf+1] = '\\'
        elseif n == 'u' then
          local hex = str:sub(pos + 2, pos + 5)
          local code = tonumber(hex, 16) or 0
          -- basic BMP -> utf8
          if code < 0x80 then
            buf[#buf+1] = string.char(code)
          elseif code < 0x800 then
            buf[#buf+1] = string.char(0xC0 + math.floor(code/0x40), 0x80 + code%0x40)
          else
            buf[#buf+1] = string.char(
              0xE0 + math.floor(code/0x1000),
              0x80 + math.floor(code/0x40)%0x40,
              0x80 + code%0x40)
          end
          pos = pos + 4
        else buf[#buf+1] = n end
        pos = pos + 2
      else
        buf[#buf+1] = c
        pos = pos + 1
      end
    end
    error('unterminated string')
  end

  local function decode_number()
    local s, e = str:find('^-?%d+%.?%d*[eE]?[+-]?%d*', pos)
    local num = tonumber(str:sub(s, e))
    pos = e + 1
    return num
  end

  decode_value = function()
    skip_ws()
    local c = str:sub(pos, pos)
    if c == '{' then
      pos = pos + 1
      local obj = {}
      skip_ws()
      if str:sub(pos, pos) == '}' then pos = pos + 1; return obj end
      while true do
        skip_ws()
        local key = decode_string()
        skip_ws()
        pos = pos + 1 -- colon
        obj[key] = decode_value()
        skip_ws()
        local nc = str:sub(pos, pos)
        pos = pos + 1
        if nc == '}' then break end
      end
      return obj
    elseif c == '[' then
      pos = pos + 1
      local arr = {}
      skip_ws()
      if str:sub(pos, pos) == ']' then pos = pos + 1; return arr end
      while true do
        arr[#arr + 1] = decode_value()
        skip_ws()
        local nc = str:sub(pos, pos)
        pos = pos + 1
        if nc == ']' then break end
      end
      return arr
    elseif c == '"' then
      return decode_string()
    elseif c == 't' then pos = pos + 4; return true
    elseif c == 'f' then pos = pos + 5; return false
    elseif c == 'n' then pos = pos + 4; return nil
    else
      return decode_number()
    end
  end

  local ok, result = pcall(decode_value)
  if ok then return result else return nil, result end
end

------------------------------------------------------------------ handle registry
local handles = {}
local handle_seq = 0

local function to_handle(ud)
  handle_seq = handle_seq + 1
  local key = handle_seq
  handles[key] = ud
  return 'handle:' .. key
end

-- Convert a return value into something JSON-friendly, registering pointers.
local function marshal(v)
  if type(v) == 'userdata' then
    return to_handle(v)
  end
  return v
end

-- Resolve incoming args: "handle:N" -> stored userdata.
local function resolve_arg(a)
  if type(a) == 'string' then
    local n = a:match('^handle:(%d+)$')
    if n then return handles[tonumber(n)] end
  end
  return a
end

local function resolve_args(args)
  local out = {}
  for i, a in ipairs(args) do out[i] = resolve_arg(a) end
  return out, #args
end

------------------------------------------------------------------ helpers for composites
local function track_by_index(i)
  return reaper.GetTrack(0, i)
end

local function get_track_name(tr)
  local _, name = reaper.GetSetMediaTrackInfo_String(tr, 'P_NAME', '', false)
  return name
end

-- linear amplitude <-> dB (REAPER volumes are linear amplitude, 1.0 == 0 dB)
local function db_to_amp(db) return 10 ^ (db / 20) end
local function amp_to_db(a)
  if a <= 0 then return -150 end
  return 20 * math.log(a, 10)
end

------------------------------------------------------------------ composite commands
local commands = {}

commands['_ping'] = function()
  return {
    version = reaper.GetAppVersion(),
    bridge = 'reaper-mcp-mac',
    time = reaper.time_precise(),
  }
end

commands['_get_project_state'] = function()
  local num = reaper.CountTracks(0)
  local tracks = {}
  for i = 0, num - 1 do
    local tr = track_by_index(i)
    tracks[#tracks + 1] = {
      index = i,
      name = get_track_name(tr),
      num_items = reaper.CountTrackMediaItems(tr),
      muted = reaper.GetMediaTrackInfo_Value(tr, 'B_MUTE') == 1,
      soloed = reaper.GetMediaTrackInfo_Value(tr, 'I_SOLO') ~= 0,
      volume_db = amp_to_db(reaper.GetMediaTrackInfo_Value(tr, 'D_VOL')),
    }
  end
  return {
    bpm = reaper.Master_GetTempo(),
    length = reaper.GetProjectLength(0),
    num_tracks = num,
    tracks = tracks,
    play_state = reaper.GetPlayState(),
  }
end

commands['_insert_track'] = function(a)
  local index = a[1] or reaper.CountTracks(0)
  local name = a[2] or ''
  reaper.InsertTrackAtIndex(index, true)
  local tr = track_by_index(index)
  if name ~= '' then
    reaper.GetSetMediaTrackInfo_String(tr, 'P_NAME', name, true)
  end
  reaper.TrackList_AdjustWindows(false)
  return { index = index, name = name }
end

commands['_delete_track'] = function(a)
  local tr = track_by_index(a[1])
  if not tr then error('no track at index ' .. tostring(a[1])) end
  reaper.DeleteTrack(tr)
  return true
end

commands['_set_track_name'] = function(a)
  local tr = track_by_index(a[1])
  if not tr then error('no track at index ' .. tostring(a[1])) end
  reaper.GetSetMediaTrackInfo_String(tr, 'P_NAME', a[2] or '', true)
  return true
end

commands['_set_track_mute'] = function(a)
  local tr = track_by_index(a[1])
  if not tr then error('no track at index ' .. tostring(a[1])) end
  reaper.SetMediaTrackInfo_Value(tr, 'B_MUTE', a[2] and 1 or 0)
  return true
end

commands['_set_track_solo'] = function(a)
  local tr = track_by_index(a[1])
  if not tr then error('no track at index ' .. tostring(a[1])) end
  reaper.SetMediaTrackInfo_Value(tr, 'I_SOLO', a[2] and 1 or 0)
  return true
end

commands['_set_track_volume_db'] = function(a)
  local tr = track_by_index(a[1])
  if not tr then error('no track at index ' .. tostring(a[1])) end
  reaper.SetMediaTrackInfo_Value(tr, 'D_VOL', db_to_amp(a[2]))
  return true
end

commands['_set_tempo'] = function(a)
  reaper.SetCurrentBPM(0, a[1], true)
  return { bpm = reaper.Master_GetTempo() }
end

-- Create a MIDI item on a track, positioned in beats (quarter notes).
commands['_create_midi_item'] = function(a)
  local tr = track_by_index(a[1])
  if not tr then error('no track at index ' .. tostring(a[1])) end
  local start_qn = a[2] or 0
  local length_qn = a[3] or 4
  local item = reaper.CreateNewMIDIItemInProj(tr, start_qn, start_qn + length_qn, true)
  -- find its index on the track
  local n = reaper.CountTrackMediaItems(tr)
  local item_index = -1
  for i = 0, n - 1 do
    if reaper.GetTrackMediaItem(tr, i) == item then item_index = i break end
  end
  return { track_index = a[1], item_index = item_index }
end

-- Add MIDI notes to an item's active take. Notes are in beats:
--   {start_beat, length_beat, pitch(0-127), velocity(1-127), channel(0-15)}
commands['_add_midi_notes'] = function(a)
  local tr = track_by_index(a[1])
  if not tr then error('no track at index ' .. tostring(a[1])) end
  local item = reaper.GetTrackMediaItem(tr, a[2])
  if not item then error('no item at index ' .. tostring(a[2])) end
  local take = reaper.GetActiveTake(item)
  if not take or not reaper.TakeIsMIDI(take) then
    error('active take is not MIDI')
  end
  local notes = a[3] or {}
  local count = 0
  for _, note in ipairs(notes) do
    local start_ppq = reaper.MIDI_GetPPQPosFromProjQN(take, note.start_beat or note[1] or 0)
    local len_beat  = note.length_beat or note[2] or 1
    local end_ppq   = reaper.MIDI_GetPPQPosFromProjQN(take,
                        (note.start_beat or note[1] or 0) + len_beat)
    local pitch = note.pitch or note[3] or 60
    local vel   = note.velocity or note[4] or 96
    local chan  = note.channel or note[5] or 0
    reaper.MIDI_InsertNote(take, false, false, start_ppq, end_ppq, chan, pitch, vel, true)
    count = count + 1
  end
  reaper.MIDI_Sort(take)
  reaper.UpdateItemInProject(item)
  return { inserted = count }
end

commands['_list_track_fx'] = function(a)
  local tr = track_by_index(a[1])
  if not tr then error('no track at index ' .. tostring(a[1])) end
  local n = reaper.TrackFX_GetCount(tr)
  local fxs = {}
  for i = 0, n - 1 do
    local _, name = reaper.TrackFX_GetFXName(tr, i, '')
    fxs[#fxs + 1] = {
      index = i,
      name = name,
      enabled = reaper.TrackFX_GetEnabled(tr, i),
    }
  end
  return fxs
end

commands['_add_fx'] = function(a)
  local tr = track_by_index(a[1])
  if not tr then error('no track at index ' .. tostring(a[1])) end
  local fx_index = reaper.TrackFX_AddByName(tr, a[2], false, 1)
  if fx_index < 0 then error('could not add fx: ' .. tostring(a[2])) end
  local _, name = reaper.TrackFX_GetFXName(tr, fx_index, '')
  return { fx_index = fx_index, name = name }
end

commands['_get_fx_params'] = function(a)
  local tr = track_by_index(a[1])
  if not tr then error('no track at index ' .. tostring(a[1])) end
  local fx = a[2]
  local n = reaper.TrackFX_GetNumParams(tr, fx)
  local params = {}
  for i = 0, n - 1 do
    local _, pname = reaper.TrackFX_GetParamName(tr, fx, i, '')
    local val, minv, maxv = reaper.TrackFX_GetParam(tr, fx, i)
    params[#params + 1] = { index = i, name = pname, value = val, min = minv, max = maxv }
  end
  return params
end

commands['_set_fx_param'] = function(a)
  local tr = track_by_index(a[1])
  if not tr then error('no track at index ' .. tostring(a[1])) end
  reaper.TrackFX_SetParam(tr, a[2], a[3], a[4])
  return true
end

-- transport
commands['_transport'] = function(a)
  local what = a[1]
  if what == 'play' then reaper.OnPlayButton()
  elseif what == 'stop' then reaper.OnStopButton()
  elseif what == 'pause' then reaper.OnPauseButton()
  elseif what == 'record' then reaper.CSurf_OnRecord()
  else error('unknown transport action: ' .. tostring(what)) end
  return { play_state = reaper.GetPlayState() }
end

commands['_set_edit_cursor'] = function(a)
  reaper.SetEditCurPos(a[1] or 0, true, false)
  return true
end

commands['_save_project'] = function()
  reaper.Main_OnCommand(40026, 0) -- File: Save project
  return true
end

------------------------------------------------------------------ dispatch
local function dispatch(func, raw_args)
  local response = { ok = false }

  local cmd = commands[func]
  if cmd then
    local ok, result = pcall(cmd, raw_args)
    if ok then
      response.ok = true
      response.ret = result
    else
      response.error = tostring(result)
    end
    return response
  end

  -- generic ReaScript call
  local fn = reaper[func]
  if type(fn) == 'function' then
    local resolved = resolve_args(raw_args)
    local packed = table.pack(pcall(fn, table.unpack(resolved, 1, raw_args.n or #raw_args)))
    local ok = packed[1]
    if ok then
      response.ok = true
      if packed.n <= 1 then
        response.ret = nil
      elseif packed.n == 2 then
        response.ret = marshal(packed[2])
      else
        local rets = {}
        for i = 2, packed.n do rets[#rets + 1] = marshal(packed[i]) end
        response.ret = rets
      end
    else
      response.error = 'Error calling ' .. func .. ': ' .. tostring(packed[2])
    end
    return response
  end

  response.error = 'Unknown function: ' .. tostring(func)
  return response
end

------------------------------------------------------------------ request loop
-- REAPER's EnumerateFiles returns a CACHED directory snapshot: files deleted
-- mid-scan still appear until the listing is re-read. So we always snapshot the
-- whole listing first (walking to the nil terminator, which refreshes the cache
-- for next time), then act on the snapshot. Passing index -1 forces a refresh
-- before we start. This avoids re-processing a just-deleted request and
-- clobbering its good response with a "could not read" error.
local function list_files()
  reaper.EnumerateFiles(bridge_dir, -1) -- force cache refresh
  local names = {}
  local i = 0
  while true do
    local f = reaper.EnumerateFiles(bridge_dir, i)
    if not f or f == '' then break end
    names[#names + 1] = f
    i = i + 1
  end
  return names
end

-- Wipe anything left over from a previous session so a stale response_<id>
-- can't be misread as the answer to a fresh reused id.
local function purge_stale()
  for _, f in ipairs(list_files()) do
    if f:match('^request_.*%.json$') or f:match('^response_.*%.json$') then
      delete_file(bridge_dir .. f)
    end
  end
end

local function process_requests()
  for _, fname in ipairs(list_files()) do
    local id = fname:match('^request_(%d+)%.json$')
    if id then
      local req_path = bridge_dir .. fname
      local resp_path = bridge_dir .. 'response_' .. id .. '.json'
      local data = read_file(req_path)
      delete_file(req_path)
      local response
      if data then
        local req = decode_json(data)
        if req and req.func then
          req.args = req.args or {}
          req.args.n = #req.args
          local ok, r = pcall(dispatch, req.func, req.args)
          response = ok and r or { ok = false, error = 'bridge error: ' .. tostring(r) }
        else
          response = { ok = false, error = 'malformed request' }
        end
      else
        response = { ok = false, error = 'could not read request file' }
      end
      write_file(resp_path, encode_json(response))
    end
  end
end

------------------------------------------------------------------ boot
ensure_dir()
purge_stale()
reaper.ShowConsoleMsg('[reaper-mcp-mac] bridge started\n  dir: ' .. bridge_dir .. '\n')

local function main()
  process_requests()
  reaper.defer(main)
end

main()
