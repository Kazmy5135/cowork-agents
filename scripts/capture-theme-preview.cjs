const { app, BrowserWindow } = require("electron");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const inputPath = resolve(__dirname, "..", "docs", "theme-previews", "field-terminal-preview.html");
const outputPath = resolve(__dirname, "..", "docs", "theme-previews", "field-terminal-preview.png");

async function capture() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    resizable: false,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const loadFinished = new Promise((resolveReady) => {
    window.webContents.once("did-finish-load", resolveReady);
  });
  await window.loadURL(pathToFileURL(inputPath).toString());
  await loadFinished;
  await new Promise((resolveReady) => setTimeout(resolveReady, 300));

  const image = await window.webContents.capturePage({
    x: 0,
    y: 0,
    width: 1280,
    height: 800
  });

  await require("node:fs/promises").writeFile(outputPath, image.toPNG());
  window.destroy();
  console.log(join("docs", "theme-previews", "field-terminal-preview.png"));
}

app.whenReady().then(() => {
  capture()
    .then(() => app.quit())
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
});
