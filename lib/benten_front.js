let ac;
let midiSound;
export let baseVolume = 0.5;
let vol;

var audioContext = new AudioContext({ latencyHint: "balanced", sampleRate: 44100 }); // Androidで正常に再生するために指定必須

export function initialize() {
    fetch('./lib/benten/benten_bg.wasm').then((wasm) => wasm.arrayBuffer()).then(wasmBuffer => {
        audioContext.resume().then(() => {
            audioContext.audioWorklet.addModule('./lib/midisound.js').then(() => {
                midiSound = new AudioWorkletNode(audioContext, "midi-sound-processor");
                vol = new GainNode(audioContext, { gain: baseVolume });
                midiSound.port.postMessage({ type: "init_wasm", wasm: wasmBuffer });

                midiSound.connect(vol).connect(audioContext.destination);
                ac = audioContext;
            });
        });
    });
}

function ensure_initialize() {
    return ac;
}
export function playBuffer(sf2Buffer, smfBuffer) {
    if (ensure_initialize()) {
        midiSound.port.postMessage({ type: "play", sf2: sf2Buffer, smf: smfBuffer, sampleRate: ac.sampleRate });
    }
}
export function stop() {
    if (ensure_initialize()) {
        midiSound.port.postMessage({ type: "stop" });
    }
}
export function setTempo(speed) {
    if (ensure_initialize()) {
        midiSound.port.postMessage({ type: "set_speed", speed });
    }
}
export function setVolume(volume) {
    if (ensure_initialize()) {
        vol.gain.value = volume * baseVolume;
    }
}

export function mute() {
    if (ensure_initialize()) {
        ac.suspend();
    }
}
export function unmute() {
    if (ensure_initialize() && ac.state == "suspended") {
        ac.resume();
    }
}

const Benten = {
    initialize: async function () { initialize(); },
    play: function (filename) { play(filename); },
    playBuffer: function (sf2Buffer, smfBuffer) { playBuffer(sf2Buffer, smfBuffer); },
    stop: function () { stop(); },
    setVolume: function (volumeFloat) { setVolume(volumeFloat); },
    mute: function () { mute(); },
    unmute: function () { unmute(); },
}
window.Benten = Benten; // @todo 
export { Benten };