document.getElementById("version-short").innerHTML = "[BW ver 0.5.9.0p]";

function playCheckSound() {
    var audio = document.getElementById('sound');
    audio.play();
}

// 画面全体にクリックとタッチスタートのリスナーを追加
document.body.addEventListener('click', playCheckSound);
document.body.addEventListener('touchend', function (event) {
    event.preventDefault(); // タッチイベントのデフォルト動作を防ぐ
    playCheckSound();
});


// ここのテキストは自由に書き換えて大丈夫です
const readyText = "[準備中]";
const descriptionText = "キーボード入力 or 画面スワイプで移動" // 今はhidden
const clickToStartText = "画面タッチで開始";
const initializeMidiText = "MIDI環境設定開始";
const initialDownloadingText = "ゲームファイルチェック中";
const buttonNormalColor = "whitesmoke"
const buttonPressedColor = "darkgrey"
var noGameHeaderFooter = false;

// ここから下はシステムに関わる部分なので基本的に触らない
document.title = WoditorGameSettings.projectName;
document.getElementById("title").innerHTML = readyText;
document.getElementById("readme").innerHTML = descriptionText;

// <base href="/GameFilesUpdate/202553/2/"> などで設定されている場合(PLiCy形式)
function getPLiCyFormatGameId(){
    const match = document.baseURI.match(/GameFilesUpdate\/(\d+)\/(\d+)/);
    if(match && match[1] && match[2]){
        const Game_ID = match[1];   //PLiCy上のGame_ID
        const Update_No = match[2]; //PLiCyでバージョンアップした回数
        return Game_ID;         //PLiCyのGame_IDをプロジェクトIDに設定
    }
    return null;
}

// Game_IDというidが iframe URLに指定されていればそれを抽出 http://example.com/iframe/Game_ID=xxx
function getGameIdFromLocationPathname() {
    const queryString = window.location.pathname;
    const match = queryString.match(/Game_ID=(\d+)/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
}

// いずれかの方式でGame_IDが指定されていないか確認して取得する
function getGameIdFromUrl() {
    const gameIdFromPLiCyFormat = getPLiCyFormatGameId();
    if(gameIdFromPLiCyFormat){
        console.log("PLiCy形式のGame_IDを取得しました");
        return gameIdFromPLiCyFormat;
    }
    const gameIdFromLocationPathname = getGameIdFromLocationPathname();
    if(gameIdFromLocationPathname){
        console.log("PathnameからGame_IDを取得しました");
        return gameIdFromLocationPathname;
    }
    console.log("サイトURLを基準のGame_IDとします");
    return null;
}

function getGameProjectPath() {
    // Game_IDというidが iframe URL に含まれていればばそれを使う
    const gameIdValue = getGameIdFromUrl();
    if (gameIdValue) {
      return gameIdValue + "_" + WoditorGameSettings.projectId;
    }

    // 設置するサイトのドメイン以降のパスを見ます(iframe内に設置した場合も表示ページのURLを基準に)
    // http://example.com/GamePlay/12345 => GamePlay_12345_project_id
    let dir = null;

    try{
        dir = top.location.pathname; // iframeではCORSが発生する可能性があるため例外処理でfallback
    }catch(e){
        dir = window.location.pathname;
    }
    
    const sep = dir.endsWith("/") ? "" : "/";
    let path = dir + sep + WoditorGameSettings.projectId;

    path = path.replace("index.html/", "");
    path = path.replaceAll(".", "_");
    if (path.startsWith("/")) {
        path = path.substring(1);
    }
    path = path.replaceAll("/", "_");

    console.log("Game project path:", path);

    return path;
}

var Module = {
    projectId: getGameProjectPath(),
    showDebugLog: 1,
    woditor: {},
    noInitialRun: true,
    preRun: [],
    postRun: [],
    print: (function () {
        return function (text) {
            text = Array.prototype.slice.call(arguments).join(' ');
            console.log(text);
        };
    })(),
    printErr: function (text) {
        text = Array.prototype.slice.call(arguments).join(' ');
        document.getElementById("error-log").innerHTML += text;
        console.error(text);
    },
    canvas: (function () {
        var canvas = document.getElementById('canvas');
        canvas.addEventListener("webglcontextlost", function (e) { alert('FIXME: WebGL context lost, please reload the page'); e.preventDefault(); }, false);
        return canvas;
    })(),
    webgl_enable_webgl2: true,
    webgl_enable_extension: ["OES_texture_float", "WEBGL_color_buffer_float"],
    title: document.getElementById("title"),
    setStatus: function (text) {
        if (text == '') {
            Module.ready = true;
            document.getElementById('title').innerHTML = clickToStartText;
            document.getElementById('touchtostart').innerHTML = clickToStartText;
        }
    },
    monitorRunDependencies: function (left) { },
    //ウディタ内部の「BrowserWoditor:」でデバッグ文が実行された時に内容の文が飛んでくる関数です
    catchGameMessage: function (message) {
        console.log(message);
    },
    playVibration: function (inputType, power, time, effectIndex) {
        playGamePadVibration(inputType, power, time, effectIndex); // 後述
    }
};

window.progressDownloading = function (loaded, total, filename) {
    const percentage = total > 0 ? Math.round(100 * loaded / total) + "%" : Math.round(loaded / 100000) / 10 + "MB";
    const progressText = filename + " [" + percentage + "]";
    document.getElementById('title').innerHTML = progressText;
    document.getElementById('touchtostart').innerHTML = progressText;
}

function registerKeyDownUp(buttonEl, keyCode) {
    buttonEl.addEventListener('mousedown', (e) => {
        buttonEl.style.backgroundColor = buttonPressedColor;
        e.preventDefault();
        dispatchKeyCode('keydown', keyCode);
    });
    buttonEl.addEventListener('mouseup', (e) => {
        buttonEl.style.backgroundColor = buttonNormalColor;
        e.preventDefault();
        dispatchKeyCode('keyup', keyCode);
    });
    buttonEl.addEventListener('touchstart', (e) => {
        buttonEl.style.backgroundColor = buttonPressedColor;
        e.preventDefault();
        dispatchKeyCode('keydown', keyCode);
    });
    buttonEl.addEventListener('touchend', (e) => {
        buttonEl.style.backgroundColor = buttonNormalColor;
        e.preventDefault();
        dispatchKeyCode('keyup', keyCode);
    });
    buttonEl.addEventListener('touchcancel', (e) => {
        buttonEl.style.backgroundColor = buttonNormalColor;
        e.preventDefault();
        dispatchKeyCode('keyup', keyCode);
    });
}
const rightClickButton = document.getElementById("right-hold");
rightClickButton.addEventListener('mousedown', (e) => {
    e.preventDefault();
    rightClickButton.style.backgroundColor = buttonPressedColor;
});
rightClickButton.addEventListener('mouseup', (e) => {
    e.preventDefault();
    rightClickButton.style.backgroundColor = buttonNormalColor;
});
rightClickButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    rightClickButton.style.backgroundColor = buttonPressedColor;
    enableMouseRightButton();
});
rightClickButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    rightClickButton.style.backgroundColor = buttonNormalColor;
    disableMouseRightButton();
});
registerKeyDownUp(document.getElementById("shift"), shift);
registerKeyDownUp(document.getElementById("esc"), cancel);
registerKeyDownUp(document.getElementById("enter"), enter);
registerKeyDownUp(document.getElementById("move-axis"), undefined);

var screenObserver = undefined;
function setCustomGameSize(width, height) { //システムの初期化時に内部から呼ばれ、画面サイズを自動的に調節します
    if (!screenObserver) {
        screenObserver = new ResizeObserver(function (mutations) {
            adjustGameUI();
        });
        screenObserver.observe(document.body);
    }
    // 入力位置補正
    Module.gameWidth = width;
    Module.gameHeight = height;

    // アス比調整
    Module.canvas.width = width;
    Module.canvas.height = height;
    adjustGameUI();
}
window.onload = () => {
    const resizableEl = document.getElementById("canvas");
    setCustomGameSize(resizableEl.width, resizableEl.height); // 標準サイズで一度呼ぶ
}

window.onerror = (err) => {
    // document.getElementById("error-log").innerHTML += err;
}
function showGameMemoryUsage() {
    if (Module && Module.HEAP8) {
        const memory = (Math.round(10 * Module.HEAP8.length / 1000000) / 10 + "MB");
        document.getElementById("memory-usage").innerHTML = "使用メモリ:" + memory;
    }
}
setInterval(showGameMemoryUsage, 1000);

function showToast(message) {
    var toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "show";
    setTimeout(function () { toast.className = toast.className.replace("show", ""); }, 3000);
}

function handleFullScreen() {
    var elem = document.getElementById("main-content");
    const isIPhone = /iPhone/i.test(navigator.userAgent);
    const isIPad = /iPad/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

    if (true || isIPhone || isIPad) { // すべてのデバイスで仮想(仮)
        if (!WoditorGameSettings.isPseudoFullscreen) {
            startPseudoFullscreen();
        } else {
            endPseudoFullscreen();
        }
        adjustGameUI();

    } else if (elem.requestFullscreen) {
        elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) { /* Safari */
        elem.webkitRequestFullscreen();
    } else if (elem.msRequestFullscreen) { /* IE11 */
        elem.msRequestFullscreen();
    }
}
function lockScreenOrientation(orientation) {
    if (orientation && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock(orientation).catch(function (error) {
            // alert("画面の向きをロックできませんでした:", error);
        });
    }
}
function tryFullScreen() {
    handleFullScreen();
    if (WoditorGameSettings.lockOrientation) {
        lockScreenOrientation(WoditorGameSettings.lockOrientation);
    }
    document.onfullscreenchange = (event) => {
        event.preventDefault();
        if (document.fullscreenElement) {
            WoditorGameSettings.isFullscreen = true;
        } else {
            WoditorGameSettings.isFullscreen = false;
        }
        adjustGameUI();
    };
}

document.getElementById('fullscreen').addEventListener('click', tryFullScreen);
document.getElementById('fullscreen').addEventListener('touchend', function (event) {
    event.preventDefault(); // タッチイベントのデフォルト動作を防ぐ
    tryFullScreen();
});

const mainContent = document.getElementById("outer");
function beforeGameStart() {
    document.getElementById('touchtostart').hidden = true;
}
function initializeGame() { // タッチ時のゲーム開始処理
    if (Module.ready && Module.woditor && !Module.woditor.initialized) {
        mainContent.ontouchend = undefined; // 何度も起動トライが走ると問題なので外す
        mainContent.onclick = undefined;

        Module.woditor.initialized = true;
        Module.woditor.textInputField = document.getElementById("textinput");

        document.getElementById('title').innerHTML = initializeMidiText;
        document.getElementById('title').innerHTML = initialDownloadingText;
        document.getElementById('touchtostart').innerHTML = initialDownloadingText;

        setTimeout(() => {
            window.Benten.initialize();
        }, 10);

        Module.callMain(); // entry point

        if (WoditorGameSettings.requestFullScreen) {
            handleFullScreen();
            lockScreenOrientation(WoditorGameSettings.lockOrientation);
        }
    }
}
mainContent.ontouchend = (e) => { //開始時タッチ
    if (e.target.localName == "a") {
        return;
    }
    e.preventDefault();
    initializeGame();
}
mainContent.onclick = (e) => { //クリックにも反応
    if (e.target.localName == "a") {
        return;
    }
    e.preventDefault();
    initializeGame();
}

window.addEventListener('touchend', function (event) { // iOSの領域外タッチ対策
    event.preventDefault();
});

window.addEventListener('beforeunload', function (event) {
    FS.syncfs(false, function (err) {
        console.log(err);
    });
});

async function customTestFileChanged(urlStr, pathStr) { // ファイルの要求時に内部から呼び出され、ファイルが更新されているかチェックしてDLするか決める
    try {
        const response = await fetch(urlStr, { method: "HEAD", redirect: 'follow' });
        if (response.status == 200) {
            var modifiedInfo = response.headers.get('ETag');
            const filePathStr = "/data0/" + Module.projectId + "-GameCache" + pathStr + "_etag";

            if (modifiedInfo === null) {
                modifiedInfo = response.headers.get('Last-Modified');
            }

            if (modifiedInfo === null) {
                modifiedInfo = "null";
            }

            if (FS.analyzePath(filePathStr, false).exists) {
                const prevModifiedInfo = FS.readFile(filePathStr, { encoding: 'utf8' });
                if (modifiedInfo !== prevModifiedInfo) { // 過去のETagが存在していてかつ違うETag
                    console.log("updated: " + pathStr, prevModifiedInfo, "=>", modifiedInfo);
                    FS.writeFile(filePathStr, modifiedInfo, { flags: 'w+' });
                    return true;
                }
            } else { // 過去のETagがそもそも存在しない(完全に新しいDL)
                console.log("new: " + pathStr, modifiedInfo);

                FS.writeFile(filePathStr, modifiedInfo, { flags: 'w+' });
                return true;
            }
        }
    } catch {
        return false;
    }
    return false;
}

function browserCheckFailed(errorCode) { // ブラウザ向け設定がされていない時に呼び出されます。ここでやるのは内部的なエラーを警告するだけです
    if (errorCode == 0) {
        alert("必要ファイルが Data.wolf の外側に配置されています\n手順を再度ご確認下さい");
    } else {
        alert("ブラウザ向けに正しく設定されていないため起動できません\n手順を再度ご確認下さい\n(バージョンアップで仕様が変更された可能性があります)")
    }
}
const noSystemTouchEl = document.getElementById("no-system-touch");
function toggleNoSystemTouch() {
    WoditorGameSettings.noSystemTouch = !WoditorGameSettings.noSystemTouch;
    if (WoditorGameSettings.noSystemTouch) {
        noSystemTouchEl.style.backgroundColor = buttonPressedColor;
    } else {
        noSystemTouchEl.style.backgroundColor = buttonNormalColor;
    }
}
if (WoditorGameSettings.noSystemTouch) { // 初期カラー設定
    noSystemTouchEl.style.backgroundColor = buttonPressedColor;
} else {
    noSystemTouchEl.style.backgroundColor = buttonNormalColor;
}

const switchUIEl = document.getElementById("switch-ui");
function toggleSwitchUI() {
    WoditorGameSettings.switchUILeftRight = !WoditorGameSettings.switchUILeftRight;
    if (WoditorGameSettings.switchUILeftRight) {
        switchUIEl.style.backgroundColor = buttonPressedColor;
    } else {
        switchUIEl.style.backgroundColor = buttonNormalColor;
    }
    adjustGameUI();
}
if (WoditorGameSettings.switchUILeftRight && switchUIEl !== null) { // 初期カラー設定
    switchUIEl.style.backgroundColor = buttonPressedColor;
} else {
    switchUIEl.style.backgroundColor = buttonNormalColor;
}

function toggleSettingVisibility() {
    const el = document.getElementById("main-footer-additional");
    el.hidden = !el.hidden;
}

document.addEventListener("visibilitychange", async (e) => {
    if (document.visibilityState === "visible") {
        if (Module && Module.AL) {
            // オーディオコンテキストを再開する処理
            for (var key in Module.AL.contexts) {
                const ctx = Module.AL.contexts[key].audioCtx;
                if (ctx.state === "suspended") {
                    await ctx.resume().then(() => {
                        console.log("AudioContext resumed.");
                    }).catch(err => {
                        console.log("Failed to resume AudioContext:", err);
                    });
                }
            }

            // MIDI再生のミュート解除
            if (window.Benten) {
                window.Benten.unmute();
            }
        }
    } else if (document.visibilityState === "hidden") {
        if (window.Benten) {
            window.Benten.mute();
        }
    }
});

// 設定ボタン
{
    const popup = document.getElementById('popup');

    function startPseudoFullscreen() {
        showToast("設定ボタンから全画面解除");

        WoditorGameSettings.isFullscreen = true;
        WoditorGameSettings.isPseudoFullscreen = true;
        adjustGameUI();
    }

    function endPseudoFullscreen() {
        if (WoditorGameSettings.isFullscreen && WoditorGameSettings.isPseudoFullscreen) {
            WoditorGameSettings.isFullscreen = false;
            WoditorGameSettings.isPseudoFullscreen = false;
            adjustGameUI();
        }
    }
    function isOpenSetting() {
        return !popup.hidden;
    }
    function openSetting() {
        popup.hidden = !popup.hidden;
    }
    function closeSetting() {
        popup.hidden = true;
    }

    const button = document.getElementById('settings');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;
    let moveCount = 0;

    button.addEventListener('mousedown', dragStart);
    button.addEventListener('touchstart', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('touchmove', drag);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('touchend', dragEnd);

    function dragStart(e) {
        e.preventDefault();
        moveCount = 0;
        startTime = new Date().getTime();
        if (e.type === "touchstart") {
            initialX = e.touches[0].clientX - xOffset;
            initialY = e.touches[0].clientY - yOffset;
        } else {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
        }

        if (e.target === button) {
            isDragging = true;
        }
    }

    function drag(e) {
        e.preventDefault();
        if (isDragging) {
            moveCount += 1;
            if (e.type === "touchmove") {
                currentX = e.touches[0].clientX - initialX;
                currentY = e.touches[0].clientY - initialY;
            } else {
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
            }

            currentX = limitedX(currentX, button);
            currentY = limitedY(currentY, button);

            xOffset = currentX;
            yOffset = currentY;

            setTranslate(currentX, currentY, button);
        }
    }

    function dragEnd(e) {
        e.preventDefault();
        const moveCountThreshold = 20;

        if (moveCount < moveCountThreshold) {
            const isTargetCanvas = e.target.id == 'canvas';
            const isTargetBody = e.target == document.body;
            if ((isTargetCanvas || isTargetBody) && isOpenSetting()) { // canvasクリックで閉じる
                closeSetting();
            }

            const isTargetSetting = e.target.id == 'settings';
            if (isTargetSetting) {
                openSetting();
            }
        }

        initialX = currentX;
        initialY = currentY;

        isDragging = false;
    }

    const outer = document.getElementById("outer");
    const outerSize = outer.getBoundingClientRect();
    const offsetX = outerSize.left;
    const offsetY = outerSize.top;
    const wholeWidth = window.innerWidth - offsetX;
    const wholeHeight = window.innerHeight - offsetY;

    function limitedX(xPos, el) {
        const rect = el.getBoundingClientRect();
        xPos -= offsetX;
        return offsetX + Math.max(wholeWidth * 0.1, Math.min(xPos, wholeWidth - rect.width - wholeWidth * 0.0125));
    }

    function limitedY(yPos, el) {
        const rect = el.getBoundingClientRect();
        yPos -= offsetY;
        return offsetY + Math.max(0, Math.min(yPos, wholeHeight - rect.height - wholeHeight * 0.1));
    }

    function setTranslate(xPos, yPos, el) {
        const rect = el.getBoundingClientRect();
        xPos = limitedX(xPos, el); // iOSで左や下すぎると他操作と被るので問題
        yPos = limitedY(yPos, el);
        el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
    }

    window.addEventListener("resize", function (e) {
        setTranslate(currentX, currentY, button);
    });
    window.addEventListener("load", function (e) {
        const rect = button.getBoundingClientRect();
        xOffset = offsetX + wholeWidth - rect.width;
        yOffset = offsetY + Math.max(0, Math.min(yOffset, wholeHeight - rect.height));
        setTranslate(xOffset, yOffset, button);
    });
}

{
    document.body.addEventListener("touchmove", function (e) { // 余白対策
        e.preventDefault();
    });
}

{
    const framelimitEl = document.getElementById("framelimit");

    function changeFrameLimit() {
        const limitFPS = WoditorGameSettings.isLimitFPS ? 30 : 60;
        Module.ccall('setFrameLimit', null, ['number'], [limitFPS]);
    }

    function toggleFrameLimit() {
        WoditorGameSettings.isLimitFPS = !WoditorGameSettings.isLimitFPS;

        if (WoditorGameSettings.isLimitFPS) {
            framelimitEl.style.backgroundColor = buttonPressedColor;
        } else {
            framelimitEl.style.backgroundColor = buttonNormalColor;
        }
        changeFrameLimit();
    }

    if (WoditorGameSettings.limitFPS == 30 && !WoditorGameSettings.isLimitFPS) {
        toggleFrameLimit();
    }
}

{
    function openLink(url) {
        showToast("ポップアップブロックが有効なとき反応しない場合があります");

        window.open(url, '_blank').focus();
    }
}

// SaveフォルダDL/UL関連
{
    // ここを変えると全体のDL/UL対象Saveフォルダが変わります
    let targetSaveFileDir = "Save";

    function mkdirs(dirpath) {
        const rootDir = FS.analyzePath(dirpath);
        if (!rootDir.exists) {
            if (!rootDir.parentExists) {
                mkdirs(rootDir.parentPath);
            }
            try {
                FS.mkdir(dirpath);
            } catch (err) {
                console.log(err);
            }
        }
    }

    // {filename: Uint8Array}
    const zipAndDownloadAllDict = (dict) => {
        var zip = new JSZip();

        for (let key in dict) {
            zip.file(key, dict[key]);
        };

        const location = document.getElementById('savedownload');

        zip.generateAsync({ type: "base64" }).then(function (base64) {
            location.href = "data:application/zip;base64," + base64;
            location.click();
        });
    }

    function downloadSaveDir() {
        const savepath = "/data0/" + Module.projectId + "-Save";

        const root = FS.lookupPath(savepath);
        const fileDict = {};

        function lookupAndAdd(node, path) {
            if (FS.isDir(node.mode)) {
                for (const [key, value] of Object.entries(node.contents)) {
                    lookupAndAdd(node.contents[key], path + node.name + "/");
                }
            }
            if (FS.isFile(node.mode)) {
                const filename = (path + node.name).substring(2);
                fileDict[filename] = node.contents.buffer;
            }
        }
        lookupAndAdd(root.node, "");

        zipAndDownloadAllDict(fileDict);
    }

    // キャッシュ領域と本体ファイル両方を上書き(フォルダが無ければ作成)
    const uploadSaveFiles = (dict) => {
        const savepath = "/data0/" + Module.projectId + "-Save";

        mkdirs(savepath + "/" + targetSaveFileDir);
        mkdirs(targetSaveFileDir);

        for (let key in dict) {
            const path = savepath + "/" + key;
            FS.writeFile(path, dict[key]);
            FS.writeFile(key, dict[key]);
        };
        FS.syncfs(false, function (err) { });
        showToast("アップロード完了");
    }

    function loadAllFiles(selectedFiles, i, stop, dict, onLoadFinished) {
        const file = selectedFiles[i];
        const reader = new FileReader();

        reader.onload = function () {
            var ar = new Uint8Array(reader.result);
            dict[targetSaveFileDir + "/" + file.name] = ar;

            if (i + 1 < stop) {
                loadAllFiles(selectedFiles, i + 1, stop, dict, onLoadFinished);
            } else {
                onLoadFinished(dict);
            }
        }

        reader.readAsArrayBuffer(file);
    }

    function uploadSaveDir() {
        const selectedFiles = document.getElementById("savefiles").files;

        if (selectedFiles.length > 0) {
            loadAllFiles(selectedFiles, 0, selectedFiles.length, {}, uploadSaveFiles);
        }
    }
}

{
    let isPlayingGanePadVibration = false;

    //ゲームパッドの振動の実装
    function playGamePadVibration(inputType, power, time, effectIndex) {
        for (let index = 0; index < navigator.getGamepads().length; ++index) {
            const gamepad = navigator.getGamepads()[index];
            if (gamepad && gamepad.vibrationActuator) {
                if (time <= 0) {
                    isPlayingGanePadVibration = false;
                    gamepad.vibrationActuator.reset();
                } else {
                    // 規定ms以上を一度に入れると上手く動かないため対策している
                    isPlayingGanePadVibration = true;
                    const maxtime = 5000;
                    let remaining = time;

                    function playGamePadVibrationRaw() {
                        gamepad.vibrationActuator.playEffect("dual-rumble", {
                            startDelay: 0,
                            duration: remaining > maxtime ? maxtime : remaining,
                            weakMagnitude: power / 1000.0,
                            strongMagnitude: power / 1000.0,
                        });
                        remaining -= maxtime;
                        if(remaining > 0){
                            setTimeout(() => {
                                if (isPlayingGanePadVibration) {
                                    playGamePadVibrationRaw();
                                }
                            }, (maxtime - 1));
                        }else{
                            isPlayingGanePadVibration = false;
                        }
                    }
                    playGamePadVibrationRaw();
                }
            }
        }
    }
}

{
    // エラー表記対策
    window.onerror = function (msg, file, line, column, err) {
        const errorMessage = msg + "\n" + file + "[line:" + line + "]\n";

        const settingButton = document.getElementById('settings');
        settingButton.style.backgroundColor = '#88000088';

        const errorText = document.getElementById('bwoditorerror');
        errorText.textContent = errorMessage;
    };
}