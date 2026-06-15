import * as benten from "./benten/benten.js";

let isPlaying = false;
let isPreviousPlaying = false;

class MidiSoundProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        this.port.onmessage = (event) => {
            if(event.data.type == "init_wasm"){
                const imports = benten.__wbg_get_imports();
                WebAssembly.instantiate(event.data.wasm, imports).then((module) => {
                    benten.__wbg_init_memory(imports);
                    benten.__wbg_finalize_init(module.instance, imports);
                });
            }
            if(event.data.type == "play"){
                if(isPlaying){
                    isPlaying = false;
                    benten.bt_stop();
                }
                benten.bt_play(event.data.sf2, event.data.smf, event.data.sampleRate);
                isPlaying = true;
            }
            if(event.data.type == "send_message"){
                benten.bt_send_message(event.data.channel, event.data.command, event.data.data1, event.data.data2);
            }
            if(event.data.type == "set_speed"){
                benten.bt_set_speed(event.data.speed);
            }
            if(event.data.type == "stop"){
                benten.bt_stop();
                isPlaying = false;
            }
            if(event.data.type == "mute"){
                isPreviousPlaying = isPlaying;
                isPlaying = false;
            }
            if(event.data.type == "unmute"){
                isPlaying = isPreviousPlaying;
            }
        }
    }

    process(inputs, outputs, parameters) {
        if(isPlaying){
            if(outputs.length > 0){
                let output = outputs[0];
                if(output.length < 1){
                    return true;
                }
                if (output.length == 1) {
                    benten.bt_process(output[0], output[0]);
                }else{
                    benten.bt_process(output[0], output[1]);
                }
            }
        }
        return true;
    }
}

registerProcessor("midi-sound-processor", MidiSoundProcessor);