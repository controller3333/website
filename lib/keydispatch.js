// ここで利用しているキーコードは下記のブラウザ標準です。現在非推奨になってしまっているため、今後変更の可能性があります
// https://developer.mozilla.org/ja/docs/Web/API/KeyboardEvent/keyCode

const right = 39;
const left = 37;
const up = 38;
const down = 40;
const enter = 13;
const cancel = 27;
const shift = 16;
const ctrl = 17;
// const alt = 18;

const dirKeys = [right, left, up, down];

let downKeyCodes = { "main": [], "sub": [] };
const dirarea = document.getElementById("canvas");
const dirarea2 = document.getElementById("move-axis");

function dispatchKeyCode(upOrDown, keyCode, mainOrSub="main"){
  const canvasEl = document.getElementById("canvas");
  if(document.activeElement !== canvasEl){
    canvasEl.focus();
  }

  let keyEvent= new KeyboardEvent(upOrDown, {keyCode: keyCode, key:keyCode, code:keyCode});
  if(upOrDown == 'keydown'){
    downKeyCodes[mainOrSub].push(keyCode);
    Module.canvas.dispatchEvent(keyEvent);
  }else if (upOrDown == 'keyup'){
    downKeyCodes[mainOrSub] = downKeyCodes[mainOrSub].filter((k) => k != keyCode);
    Module.canvas.dispatchEvent(keyEvent);
  }
}
function cancelAllDirKeyCodes(mainOrSub){
  const downDirKeyCodes = [];
  downKeyCodes[mainOrSub].forEach((keyCode) => { 
    if(dirKeys.includes(keyCode)){
      downDirKeyCodes.push(keyCode);
    }
  });
  downDirKeyCodes.forEach((keyCode) => {
    dispatchKeyCode('keyup', keyCode, mainOrSub);
  });
}

function dispatchDirKeyWithDelta(dx, dy, mainOrSub){
  let angleUnit = 360.0 / 16.0;
  const vectorX = dx || 0.0;
  const vectorY = dy || 0.0;
  const degree = (-180.0 * (Math.atan2(vectorY, vectorX) / Math.PI) + 360.0) % 360;
  const force = Math.sqrt(vectorX * vectorX + vectorY * vectorY);
  const threshold = 10;
  let nanameScale = 1.0;

  const downDirKeyCodes = downKeyCodes[mainOrSub].filter((keyCode) => dirKeys.includes(keyCode));
  if(downDirKeyCodes.length > 0){
    nanameScale = 0.5;
  }

  if(13 * angleUnit < degree || degree < 3 * angleUnit){
    if(!downKeyCodes[mainOrSub].includes(right) && force > threshold * nanameScale){
      if(downKeyCodes[mainOrSub].includes(left)){
        dispatchKeyCode('keyup', left, mainOrSub); 
      }
      dispatchKeyCode('keydown', right, mainOrSub);                 
    }
  }
  if(1 * angleUnit < degree && degree < 7 * angleUnit){
    if(!downKeyCodes[mainOrSub].includes(up) && force > threshold * nanameScale){
      if(downKeyCodes[mainOrSub].includes(down)){
        dispatchKeyCode('keyup', down, mainOrSub); 
      }
      dispatchKeyCode('keydown', up, mainOrSub);                 
    }
  }
  if(5 * angleUnit < degree && degree < 11 * angleUnit){
    if(!downKeyCodes[mainOrSub].includes(left) && force > threshold * nanameScale){
      if(downKeyCodes[mainOrSub].includes(right)){
        dispatchKeyCode('keyup', right, mainOrSub); 
      }
      dispatchKeyCode('keydown', left, mainOrSub);                 
    }
  }
  if(9 * angleUnit < degree && degree < 15 * angleUnit){
    if(!downKeyCodes[mainOrSub].includes(down) && force > threshold * nanameScale){
      if(downKeyCodes[mainOrSub].includes(up)){
        dispatchKeyCode('keyup', up, mainOrSub); 
      }
      dispatchKeyCode('keydown', down, mainOrSub);                 
    }
  }
  if(downKeyCodes[mainOrSub].includes(right) && Math.abs(vectorX) < threshold * nanameScale){
    dispatchKeyCode('keyup', right, mainOrSub);                 
  }
  if(downKeyCodes[mainOrSub].includes(up) && Math.abs(vectorY) < threshold * nanameScale){
    dispatchKeyCode('keyup', up, mainOrSub);                 
  }
  if(downKeyCodes[mainOrSub].includes(left) && Math.abs(vectorX) < threshold * nanameScale){
    dispatchKeyCode('keyup', left, mainOrSub);                 
  }
  if(downKeyCodes[mainOrSub].includes(down) && Math.abs(vectorY) < threshold * nanameScale){
    dispatchKeyCode('keyup', down, mainOrSub);                 
  }
  if(force < threshold){
    cancelAllDirKeyCodes(mainOrSub);
  }
}

const noSystemTouch = () => {
  const result = WoditorGameSettings?.noSystemTouch;
  return result;
}
let mouseRightButtonFlag = false;

function enableMouseRightButton(){
  mouseRightButtonFlag = true;
}
function disableMouseRightButton(){
  mouseRightButtonFlag = false;
}

const canvasEl = document.getElementById("canvas");
let touches = {};
canvasEl.addEventListener('touchstart', handleTouchStart, false);
canvasEl.addEventListener('touchmove', handleTouchMove, false);
canvasEl.addEventListener('touchend', handleTouchEnd, false);

function handleTouchStart(e) {
  if(noSystemTouch()){
    e.preventDefault(); 
    const newTouches = e.changedTouches;
    for (let i = 0; i < newTouches.length; i++) {
        const touch = newTouches[i];
        touches[touch.identifier] = {
            x: touch.pageX - canvas.offsetLeft,
            y: touch.pageY - canvas.offsetTop
        };
    }
    dispatchTouchMouseEvent(e);
  }
}

function handleTouchMove(e) {
  if(noSystemTouch()){
    e.preventDefault();
    const movedTouches = e.changedTouches;
    for (let i = 0; i < movedTouches.length; i++) {
        const touch = movedTouches[i];
        if (touches[touch.identifier]) {
            touches[touch.identifier] = {
                x: touch.pageX - canvas.offsetLeft,
                y: touch.pageY - canvas.offsetTop
            };
        }
    }
    dispatchTouchMouseEvent(e);
  }
}

function handleTouchEnd(e) {
  if(noSystemTouch()){
    e.preventDefault(); 
    const endedTouches = e.changedTouches;
    for (let i = 0; i < endedTouches.length; i++) {
        const touch = endedTouches[i];
        delete touches[touch.identifier];
    }
    dispatchTouchMouseEvent(e);
  }
}

function dispatchTouchMouseEvent(evt) {
  let type = null;
  let touch = null;
  let buttonType = mouseRightButtonFlag ? 1 : 0; 
  let buttonState = buttonType + 1;
  let touchIndex = 0;

  switch (evt.type) {
    case "touchstart":
      type = "mousedown";
      touch = evt.changedTouches[touchIndex];
      break;
    case "touchmove":
      type = "mousemove";
      touch = evt.changedTouches[touchIndex];
      break;
    case "touchend":
      type = "mouseup";
      buttonState = 0;
      touch = evt.changedTouches[touchIndex];
    case "touchcancel":
      type = "mouseup";
      buttonState = 0;
      touch = evt.changedTouches[touchIndex];
      break;
  }
  const newEvt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    detail: 1,
    button: buttonType,
    buttons: buttonState,
    view: window,
    clientX: touch.clientX,
    clientY: touch.clientY,
    screenX: touch.screenX,
    screenY: touch.screenY,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    relatedTarget: null
  });

  canvasEl.dispatchEvent(newEvt); // マウスを投げる
}

const dirMC = new Hammer.Manager(dirarea);
const pan = new Hammer.Pan({ event: 'pan'});
dirMC.add([pan]);
dirMC.on('pan', function(e){
  if(!noSystemTouch()){
    e.preventDefault();
    dispatchDirKeyWithDelta(e.deltaX, e.deltaY, "main")
  }
});
dirMC.on('panend', function(e){
  if(!noSystemTouch()){
    e.preventDefault();
    cancelAllDirKeyCodes("main");
  }
});

const dirMC2 = new Hammer.Manager(dirarea2);
const pan2 = new Hammer.Pan({ event: 'pan'});
dirMC2.add([pan2]);
dirMC2.on('pan', function(e){
  e.preventDefault();
  dispatchDirKeyWithDelta(e.deltaX, e.deltaY, "sub")
});
dirMC2.on('panend', function(e){
  e.preventDefault();
  cancelAllDirKeyCodes("sub");
});

function dispatchClick(keyCode){
  dispatchKeyCode('keydown', keyCode, "main");
  setTimeout(function(){ dispatchKeyCode('keyup', keyCode, "main"); }, 100);
}