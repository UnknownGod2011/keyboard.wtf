// Offline pet-only protocol/resource checks. No credential store, provider, network or real microphone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLumaVoiceAdapter, validateLumaGrant, LUMA_LIVE_SOCKET } from '../../production/site/luma/luma-live.js';
import { WinterAudio, MOODS } from '../../production/site/luma/winter-audio.js';

let assertions = 0;
let serializedWireSessions = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const grant = () => ({ token: 'auth_tokens/synthetic-offline-test', model: 'gemini-3.8-live',
  expiresAt: new Date(Date.now() + 300000).toISOString(), newSessionExpiresAt: new Date(Date.now() + 40000).toISOString(),
  sessionSeconds: 300, websocketUrl: LUMA_LIVE_SOCKET });

function fakeEnvironment({ permissionDenied = false, requireActivation = false } = {}) {
  const effects = { microphoneRequests: 0, tokenRequests: 0, sockets: [], audioContexts: [], tracks: [],
    processor: null, timers: new Map(), listeners: new Map(), counter: 0, activeGesture: true,
    audioSources: [], audioBuffers: [], audioGains: [] };
  class FakeAudioContext {
    constructor() { this.currentTime = 0; this.state = 'suspended'; this.destination = {};
      this.audioWorklet = { addModule: async () => {} }; effects.audioContexts.push(this); }
    async resume() { this.resumed = true; this.resumeWithGesture = effects.activeGesture;
      if (requireActivation && !effects.activeGesture) throw new Error('Synthetic autoplay denial.');
      this.state = 'running'; }
    async close() { this.closed = true; }
    createGain() { const gain = { gain: { value: 1 }, connect(node) { this.destination = node; } };
      effects.audioGains.push(gain); return gain; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createBuffer(_channels, samples, rate) { const pcm = new Float32Array(samples);
      const buffer = { duration: samples / rate, sampleRate: rate, getChannelData: () => pcm };
      effects.audioBuffers.push(buffer); return buffer; }
    createBufferSource() {
      const source = { connect(node) { this.destination = node; }, disconnect() { this.disconnected = true; },
        start(at) { this.started = true; this.startsAt = at; }, stop() { this.stopped = true; } };
      effects.audioSources.push(source); return source;
    }
  }
  class FakeWorklet {
    constructor() { this.port = { postMessage() {} }; effects.processor = this; }
    connect() {}
    disconnect() { this.disconnected = true; }
  }
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 1; this.bufferedAmount = 0; this.sent = [];
      effects.sockets.push(this); queueMicrotask(() => this.onopen?.()); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.closed = true; this.readyState = 3; }
    emit(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  }
  const env = {
    document: { hidden: false, addEventListener(name, callback) { effects.listeners.set(name, callback); },
      removeEventListener(name) { effects.listeners.delete(name); } },
    addEventListener(name, callback) { effects.listeners.set(name, callback); },
    removeEventListener(name) { effects.listeners.delete(name); },
    AudioContext: FakeAudioContext, AudioWorkletNode: FakeWorklet, WebSocket: FakeSocket,
    navigator: { mediaDevices: { async getUserMedia() {
      effects.microphoneRequests++;
      if (permissionDenied) { const error = new Error(); error.name = 'NotAllowedError'; throw error; }
      const track = { enabled: true, stop() { this.stopped = true; } };
      effects.tracks.push(track);
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    } } },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout(callback, delay) { const id = ++effects.counter; effects.timers.set(id, { callback, delay }); return id; },
    setInterval(callback, delay) { const id = ++effects.counter; effects.timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { effects.timers.delete(id); }, clearInterval(id) { effects.timers.delete(id); },
  };
  return { env, effects };
}

async function connected({ grantFactory = grant, canStart, environmentOptions } = {}) {
  const { env, effects } = fakeEnvironment(environmentOptions);
  const states = [], captions = [], errors = [];
  let stops = 0;
  const adapter = createLumaVoiceAdapter({ environment: env, canStart,
    requestToken: async () => { effects.tokenRequests++; return grantFactory(); } });
  const start = adapter.start({ onState: state => states.push(state), onCaption: (text, role) => captions.push({ text, role }),
    onError: error => errors.push(error), onStop: () => stops++ });
  for (let retry = 0; retry < 10 && !effects.sockets.length && adapter.getState() !== 'idle'; retry++) await tick();
  if (effects.sockets.length) effects.sockets[0].emit({ setupComplete: {} });
  await start;
  await tick();
  return { env, effects, adapter, states, captions, errors, stops: () => stops };
}

// Optional cross-language producer/consumer gate. Use the actual compiled C#
// response record + private broker serializer, not a hand-written JS grant.
// Build the private preview tool before running with --wire-contract. Its fixture
// mode emits an inert synthetic grant and never accesses keys/provider/microphone.
if (process.argv.includes('--wire-contract')) {
  const tool = fileURLToPath(new URL('../../tools/KeyboardWtf.LumaPreview/bin/Debug/net8.0-windows/KeyboardWtf.LumaPreview.dll', import.meta.url));
  const wire = JSON.parse(execFileSync('dotnet', [tool, 'contract-fixture'],
    { encoding: 'utf8', timeout: 8000, windowsHide: true }));
  check(Object.keys(wire).sort(), ['expiresAt', 'model', 'newSessionExpiresAt', 'sessionSeconds', 'token', 'websocketUrl']);
  check(validateLumaGrant(wire).websocketUrl, LUMA_LIVE_SOCKET);
  const legacy = { ...wire, webSocketUrl: wire.websocketUrl };
  delete legacy.websocketUrl;
  assert.throws(() => validateLumaGrant(legacy)); assertions++;
  for (let cycle = 0; cycle < 50; cycle++) {
    const session = await connected({ grantFactory: () => wire });
    check(session.errors, []); check(session.adapter.getState(), 'listening');
    check(session.effects.tokenRequests, 1); check(session.effects.sockets.length, 1);
    check(session.effects.sockets[0].sent.length, 2);
    session.adapter.dispose();
    check(session.effects.tracks[0].stopped, true);
    check(session.effects.audioContexts[0].closed, true);
    serializedWireSessions++;
  }
}

// The availability/busy check may cross a network turn. Audio activation must stay
// on the original click, while no microphone/token is acquired before the check.
{
  const { env, effects } = fakeEnvironment({ requireActivation: true });
  const errors = [];
  let allow;
  const availability = new Promise(resolve => { allow = resolve; });
  const adapter = createLumaVoiceAdapter({ environment: env, canStart: () => availability,
    requestToken: async () => { effects.tokenRequests++; return grant(); } });
  const pending = adapter.start({ onError: error => errors.push(error) });
  effects.activeGesture = false;
  await tick();
  check(effects.microphoneRequests, 0); check(effects.tokenRequests, 0);
  allow(true);
  for (let retry = 0; retry < 10 && !effects.sockets.length && adapter.getState() !== 'idle'; retry++) await tick();
  effects.sockets[0]?.emit({ setupComplete: {} });
  await pending;
  check(effects.audioContexts[0].resumeWithGesture, true);
  check(errors.length, 0); check(adapter.getState(), 'listening');
  adapter.dispose(); check(effects.audioContexts[0].closed, true);
}

// Grant validation rejects permanent keys/arbitrary URL/model/unbounded duration before socket creation.
{
  const {env,effects}=fakeEnvironment();const errors=[];
  const adapter=createLumaVoiceAdapter({environment:env,canStart:()=>{throw Error("Luma's earlier short Voice connection is still reserved. Try again in 123 seconds.");},requestToken:async()=>{effects.tokenRequests++;return grant();}});
  await adapter.start({onError:error=>errors.push(error)});
  check(errors,["Luma's earlier short Voice connection is still reserved. Try again in 123 seconds."]);
  check(effects.microphoneRequests,0);check(effects.tokenRequests,0);check(effects.audioContexts[0].closed,true);
  adapter.dispose();
}
check(validateLumaGrant(grant()).model, 'gemini-3.8-live');
// Provider transcript events are deltas; retain the real turn, not just its last chunk.
{
  const session = await connected();
  const socket = session.effects.sockets[0];
  socket.emit({serverContent:{outputTranscription:{text:'Hey there, '}}});
  socket.emit({serverContent:{outputTranscription:{text:'how are you!'},modelTurn:{parts:[{text:'Duplicate fallback'}]}}});
  await tick();await tick();
  check(session.captions.at(-1),{text:'Hey there, how are you!',role:'assistant'});
  socket.emit({serverContent:{turnComplete:true}});await tick();
  socket.emit({serverContent:{inputTranscription:{text:'How do '}}});
  socket.emit({serverContent:{inputTranscription:{text:'I install Helper?'}}});
  await tick();await tick();
  check(session.captions.at(-1),{text:'How do I install Helper?',role:'user'});
  socket.emit({serverContent:{outputTranscription:{text:'Use the official Helper link.'}}});await tick();
  check(session.captions.at(-1),{text:'Use the official Helper link.',role:'assistant'});
  socket.emit({serverContent:{interrupted:true}});await tick();
  socket.emit({serverContent:{outputTranscription:{text:'New response.'}}});await tick();
  check(session.captions.at(-1),{text:'New response.',role:'assistant'});
  socket.emit({serverContent:{outputTranscription:{text:'x'.repeat(4000)}}});await tick();
  check(session.captions.at(-1).text.length,2000);
  session.adapter.dispose();
}
for (const invalid of [ { token: 'permanent-key' }, { websocketUrl: 'wss://attacker.invalid/' },
  { model: 'gemini-arbitrary' }, { sessionSeconds: 301 }, { expiresAt: new Date(Date.now() + 999999).toISOString() },
  { expiresAt: 'not-a-date' }, { newSessionExpiresAt: new Date(Date.now() - 10).toISOString() } ]) {
  assert.throws(() => validateLumaGrant({ ...grant(), ...invalid })); assertions++;
}

for (let cycle = 0; cycle < 30; cycle++) {
  const session = await connected();
  const { adapter, effects } = session;
  check(effects.microphoneRequests, 1); check(effects.tokenRequests, 1); check(effects.sockets.length, 1);
  check(effects.sockets[0].sent.length, 2); // One setup + exactly one greeting after setupComplete.
  check(effects.sockets[0].sent[0].setup.model, 'models/gemini-3.8-live');
  check(effects.sockets[0].sent[1].clientContent.turns[0].parts[0].text, 'Greet me briefly, introduce yourself as my keyboard.wtf guide, and invite a product question.');
  await adapter.start(); check(effects.tokenRequests, 1);
  effects.sockets[0].emit({ setupComplete: {} }); await tick(); check(effects.sockets[0].sent.length, 2);
  effects.sockets[0].emit({ serverContent: { outputTranscription: { text: 'Hello.' },
    modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAAAA==' } }] } } });
  await tick(); check(adapter.getState(), 'speaking');
  check(session.captions.at(-1), { text: 'Hello.', role: 'assistant' });
  effects.sockets[0].emit({ serverContent: { interrupted: true } }); await tick();
  check(adapter.getState(), 'listening');
  adapter.setMuted(true); check(effects.tracks[0].enabled, false);
  check(effects.sockets[0].sent.at(-1), { realtimeInput: { audioStreamEnd: true } });
  adapter.setMuted(false); check(effects.tracks[0].enabled, true);
  envHidden(session); check(adapter.getState(), 'idle');
  check(effects.tracks[0].stopped, true); check(effects.audioContexts[0].closed, true);
  check(effects.sockets[0].closed, true); check(effects.timers.size, 0);
  check(session.stops(), 1); check(session.errors.length, 0);
  adapter.dispose(); check(effects.listeners.size, 0);
}

// Admission applies before a new grant only; its own cooldown must not be
// mistaken for a busy native microphone during an already healthy session.
{
  const phases=[];
  const session=await connected({canStart:({phase})=>{phases.push(phase);return true;}});
  const health=[...session.effects.timers.values()].find(timer=>timer.delay===1000);
  await health.callback();
  check(phases,['start','start','health']);
  check(session.adapter.getState(),'listening');
  session.adapter.dispose();
}
function envHidden(session) { session.env.document.hidden = true; session.effects.listeners.get('visibilitychange')(); }

// Actual PCM order/amplitude/destination, not merely a "speaking" UI callback.
for (let cycle = 0; cycle < 30; cycle++) {
  const session = await connected();
  const pcm = Buffer.alloc(8);
  [-32768, -16384, 0, 32767].forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
  const chunk = { inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm.toString('base64') } };
  session.effects.sockets[0].emit({ serverContent: { modelTurn: { parts: [chunk, chunk] }, turnComplete: true } });
  await tick();
  const [first, second] = session.effects.audioSources;
  const gain = session.effects.audioGains[0];
  check(session.effects.audioBuffers.length, 2);
  check([...first.buffer.getChannelData(0)], [-1, -.5, 0, 32767 / 32768]);
  check(first.buffer.sampleRate, 24000); check(first.started, true); check(second.started, true);
  check(first.destination, gain); check(gain.destination, session.effects.audioContexts[0].destination);
  check(gain.gain.value, 1); check(second.startsAt, first.startsAt + first.buffer.duration);
  first.onended(); check(session.adapter.getState(), 'speaking');
  second.onended(); check(session.adapter.getState(), 'listening');
  check(first.disconnected, true); check(second.disconnected, true);
  session.adapter.setMuted(true); check(gain.gain.value, 0);
  session.adapter.setMuted(false); check(gain.gain.value, 1);
  session.adapter.dispose();
  check(session.effects.audioContexts[0].closed, true);
}

// Denial is before token mint; busy native voice is even before microphone permission.
{
  const { env, effects } = fakeEnvironment({ permissionDenied: true }); const errors = [];
  const adapter = createLumaVoiceAdapter({ environment: env, requestToken: async () => { effects.tokenRequests++; return grant(); } });
  await adapter.start({ onError: error => errors.push(error) });
  check(effects.microphoneRequests, 1); check(effects.tokenRequests, 0); check(effects.sockets.length, 0);
  check(adapter.getState(), 'idle'); check(errors[0].includes('permission'), true); adapter.dispose();
}
{
  const { env, effects } = fakeEnvironment();
  const adapter = createLumaVoiceAdapter({ environment: env, canStart: async () => false, requestToken: async () => grant() });
  await adapter.start(); check(effects.microphoneRequests, 0); check(effects.sockets.length, 0);
  check(effects.audioContexts[0].closed, true); adapter.dispose();
}
{
  const { env, effects } = fakeEnvironment();
  const errors = [];
  const adapter = createLumaVoiceAdapter({ environment: env, canStart: () => { throw new Error('Synthetic unavailable.'); },
    requestToken: async () => { effects.tokenRequests++; return grant(); } });
  await adapter.start({ onError: error => errors.push(error) });
  check(effects.microphoneRequests, 0); check(effects.tokenRequests, 0); check(effects.sockets.length, 0);
  check(effects.audioContexts[0].closed, true); check(errors.length, 1);
  check(effects.timers.size, 0); adapter.dispose();
}
{
  const { env, effects } = fakeEnvironment({ requireActivation: true });
  const errors = [], unhandled = [];
  const rejection = error => unhandled.push(error);
  process.on('unhandledRejection', rejection);
  effects.activeGesture = false;
  const adapter = createLumaVoiceAdapter({ environment: env, canStart: () => new Promise(() => {}),
    requestToken: async () => { effects.tokenRequests++; return grant(); } });
  try {
    await adapter.start({ onError: error => errors.push(error) }); await tick();
    check(effects.microphoneRequests, 0); check(effects.tokenRequests, 0);
    check(effects.audioContexts[0].closed, true); check(errors.length, 1);
    check(effects.timers.size, 0); check(unhandled.length, 0);
  } finally { adapter.dispose(); process.off('unhandledRejection', rejection); }
}
{
  const { env, effects } = fakeEnvironment();
  const unhandled = [], errors = [];
  const rejection = error => unhandled.push(error);
  process.on('unhandledRejection', rejection);
  let approve;
  const adapter = createLumaVoiceAdapter({ environment: env,
    canStart: () => new Promise(resolve => { approve = resolve; }),
    requestToken: async () => { effects.tokenRequests++; return grant(); } });
  try {
    const pending = adapter.start({ onError: error => errors.push(error) });
    await tick(); adapter.stop(); await pending;
    approve(true); await tick();
    check(effects.microphoneRequests, 0); check(effects.tokenRequests, 0);
    check(effects.audioContexts[0].closed, true); check(errors.length, 0);
    check(effects.timers.size, 0); check(unhandled.length, 0);
  } finally { adapter.dispose(); process.off('unhandledRejection', rejection); }
}
{
  const session = await connected({ grantFactory: () => ({ ...grant(), token: 'permanent-key' }) });
  check(session.effects.sockets.length, 0); check(session.effects.tracks[0].stopped, true);
  check(session.effects.audioContexts[0].closed, true); check(session.errors.length, 1); session.adapter.dispose();
}
{
  const session = await connected();
  session.effects.sockets[0].onclose(); await tick();
  check(session.adapter.getState(), 'idle'); check(session.errors.length, 1);
  check(session.effects.sockets.length, 1); check(session.effects.tokenRequests, 1); // No reconnect/replay.
  session.adapter.dispose();
}
{
  const session = await connected();
  session.effects.sockets[0].emit({ toolCall: { functionCalls: [{ name: 'open_site' }] } }); await tick();
  check(session.adapter.getState(), 'idle'); check(session.errors.length, 1);
  check(session.effects.sockets[0].sent.length, 2); session.adapter.dispose();
}
{
  const session = await connected();
  const pending = session.effects.processor.port.onmessage;
  session.adapter.stop();
  pending({ data: { pcm: new ArrayBuffer(3200), peak: .1 } });
  check(session.effects.sockets[0].sent.length, 2); check(session.stops(), 1); session.adapter.dispose();
}
{
  const { env, effects } = fakeEnvironment();
  const adapter = createLumaVoiceAdapter({ environment: env, requestToken: async () => grant() });
  const pending = adapter.start();
  for (let retry = 0; retry < 10 && !effects.sockets.length; retry++) await tick();
  check(effects.sockets[0].sent.length, 1); // Never greet before setupComplete.
  adapter.stop(); await pending;
  check(adapter.getState(), 'idle'); check(effects.timers.size, 0); adapter.dispose();
}
{
  const { env, effects } = fakeEnvironment();
  let approve;
  const lateTrack = { stopped: false, stop() { this.stopped = true; } };
  env.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { approve = resolve; });
  const adapter = createLumaVoiceAdapter({ environment: env, requestToken: async () => grant() });
  const pending = adapter.start();
  for (let retry = 0; retry < 10 && !approve; retry++) await tick();
  adapter.stop(); await pending;
  approve({ getTracks: () => [lateTrack] }); await tick();
  check(lateTrack.stopped, true); check(effects.sockets.length, 0);
  check(effects.audioContexts[0].closed, true); check(effects.timers.size, 0); adapter.dispose();
}
{
  let permitted = true;
  const session = await connected({ canStart: async () => permitted });
  permitted = false;
  await [...session.effects.timers.values()].find(timer => timer.delay === 1000).callback();
  check(session.adapter.getState(), 'idle'); check(session.effects.tracks[0].stopped, true);
  check(session.errors[0].includes('active voice task'), true); session.adapter.dispose();
}
{
  const session = await connected();
  const originalNow = Date.now;
  const later = Date.now() + 31000;
  try {
    Date.now = () => later;
    await [...session.effects.timers.values()].find(timer => timer.delay === 1000).callback();
  } finally { Date.now = originalNow; }
  check(session.adapter.getState(), 'idle'); check(session.errors[0].includes('receive a response'), true);
  check(session.effects.sockets.length, 1); session.adapter.dispose();
}

// Worklet generates bounded 16kHz little-endian PCM and zero monitoring output, and honors mute.
let Processor;
const messages = [];
const sandbox = { sampleRate: 48000, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: m => messages.push(m) }; } },
  registerProcessor: (name, type) => { check(name, 'luma-pcm-capture'); Processor = type; }, Int16Array, ArrayBuffer, DataView, Math };
vm.runInNewContext(fs.readFileSync(new URL('../../production/site/luma/luma-live-worklet.js', import.meta.url), 'utf8'), sandbox);
const processor = new Processor();
const output = new Float32Array(128).fill(1);
for (let block = 0; block < 38; block++) processor.process([[new Float32Array(128).fill(.5)]], [[output]]);
check(messages.length, 1); check(messages[0].pcm.byteLength, 3200); check(messages[0].peak, .5);
check(new DataView(messages[0].pcm).getInt16(0, true), 16383); check(output.every(value => value === 0), true);
processor.port.onmessage({ data: { muted: true } });
for (let block = 0; block < 50; block++) processor.process([[new Float32Array(128).fill(.5)]], [[output]]);
check(messages.length, 1);

// Ambience is initially silent, but uses full pet-level gain when explicitly
// enabled. Every mood applies a distinct frequency/filter/gain profile. Fake
// audio only: this does not read credentials or connect a real output device.
const oldWindow = globalThis.window, oldDocument = globalThis.document;
const ambienceEffects = { contexts: [], listeners: new Map() };
const audioParam = (value = 0) => ({ value, setTargetAtTime(target, at, constant) {
  this.target = target; this.at = at; this.constant = constant;
}, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
const audioNode = properties => ({ ...properties, connect() {}, disconnect() {}, start() {}, stop() {} });
class FakeAmbienceContext {
  constructor() { this.currentTime = 0; this.sampleRate = 320; this.state = 'suspended';
    this.destination = {}; ambienceEffects.contexts.push(this); }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
  createGain() { return audioNode({ gain: audioParam(1) }); }
  createDynamicsCompressor() { return audioNode({ threshold: audioParam(), ratio: audioParam() }); }
  createAnalyser() { return audioNode({ getFloatTimeDomainData(samples) { samples.fill(.01); } }); }
  createConvolver() { return audioNode({}); }
  createBuffer(channels, samples) { const data = Array.from({ length: channels }, () => new Float32Array(samples));
    return { getChannelData: channel => data[channel] }; }
  createBufferSource() { return audioNode({}); }
  createBiquadFilter() { return audioNode({ frequency: audioParam() }); }
  createOscillator() { return audioNode({ frequency: audioParam(), detune: audioParam() }); }
  createStereoPanner() { return audioNode({ pan: audioParam() }); }
}
try {
  globalThis.window = { AudioContext: FakeAmbienceContext };
  globalThis.document = { hidden: false, addEventListener(name, callback) { ambienceEffects.listeners.set(name, callback); },
    removeEventListener(name) { ambienceEffects.listeners.delete(name); } };
  for (let cycle = 0; cycle < 30; cycle++) {
    let paused = false, speaking = false;
    const status = { textContent: '', dataset: {} };
    const audio = new WinterAudio({ status, isPaused: () => paused, wind: () => .22, duck: () => speaking });
    check(audio.enabled, false); check(audio.volume, 1); check(audio.context, undefined);
    audio.setVolume(1); await audio.setEnabled(true);
    check(audio.master.gain.target, 1); check(audio.context.state, 'running');
    const fingerprints = new Set();
    for (const [key, mood] of Object.entries(MOODS)) {
      audio.setMood(key);
      check(status.dataset.mood, key);
      check(audio.pads.map(pad => pad.o.frequency.target), mood.tones.flatMap(tone => [tone, tone]));
      check(audio.windFilter.frequency.target, mood.cutoff);
      fingerprints.add(JSON.stringify([audio.pads.map(pad => pad.o.frequency.target), audio.windGain.gain.target]));
    }
    check(fingerprints.size, 4);
    speaking = true; audio.sync(); check(audio.master.gain.target, .25);
    speaking = false; audio.sync(); check(audio.master.gain.target, 1);
    audio.setVolume(5); check(audio.volume, 1);
    audio.setVolume(Number.NaN); check(audio.volume, 1);
    audio.setVolume(-1); check(audio.volume, 0); check(audio.master.gain.target, 0);
    audio.setVolume(1); paused = true; audio.sync(); check(audio.master.gain.target, 0);
    paused = false; audio.sync(); check(audio.master.gain.target, 1);
    await audio.setEnabled(false); check(audio.master.gain.target, 0);
    const context = audio.context;
    audio.destroy(); check(context.state, 'closed'); check(ambienceEffects.listeners.size, 0);
  }
} finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }

console.log(JSON.stringify({ status: 'passed', assertions, syntheticSessions: 60 + serializedWireSessions, serializedWireSessions, syntheticAmbienceCycles: 30,
  providerRequests: 0, actualMicrophones: 0, credentialsRead: 0, managedBillingWrites: 0 }));
