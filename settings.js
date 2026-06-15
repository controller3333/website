const WoditorGameSettings = {
    projectId: "default",                     // ブラウザの保存先に利用されます(一応日本語でも可)
    projectName: "ウルファールのサンプルゲーム", // タイトルバーに表示されます
    noSystemTouch: false,                     // false 何もしない true ブラウザウディタが用意したタッチ操作を無効化してマウスエミュレート
    requestFullScreen: false,                 // false 何もしない true ゲーム起動時に↓方向のフルスクリーン化を試みる(iOS無効)
    lockOrientation: "landscape-primary",     // 固定する画面方向(フルスクリーン時のみ有効) 
    /* undefined(引用符なし/全画面のみ) "landscape-primary"(通常横)、"landscape-secondary"(逆横) "portrait-primary"(通常縦) "portrait-secondary"(逆縦)*/
    hideHeaderFooter: false,                  // false 何もしない true タイトルバーと説明書等へのリンクを隠す
    hideSideButtons: false,                   // false 何もしない true 左右のボタンを隠す
    switchUILeftRight: false,                 // false 何もしない true ボタンUIの配置を左右逆転する
    limitFPS: 60,                             // 30 or 60
}
