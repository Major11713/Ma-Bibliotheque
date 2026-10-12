let nativeStream = null;
let nativeLoop = 0;
let zxingControls = null;
let activeTrack = null;
let torchEnabled = false;

async function supportsNativeEan() {
  if (!('BarcodeDetector' in window) || !BarcodeDetector.getSupportedFormats) return false;
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    return formats.includes('ean_13');
  } catch { return false; }
}

export async function startScanner(video, onResult, onState = () => {}) {
  await stopScanner();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('La caméra n’est pas disponible dans ce navigateur.');
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };

  if (await supportsNativeEan()) {
    nativeStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = nativeStream;
    await video.play();
    activeTrack = nativeStream.getVideoTracks()[0] || null;
    onState({ engine: 'native', torch: hasTorch() });
    const detector = new BarcodeDetector({ formats: ['ean_13'] });
    let lastAttempt = 0;
    const scanFrame = async (time) => {
      if (!nativeStream) return;
      if (time - lastAttempt > 220 && video.readyState >= 2) {
        lastAttempt = time;
        try {
          const results = await detector.detect(video);
          if (results[0]?.rawValue) onResult(results[0].rawValue);
        } catch { /* Une image non décodable est normale. */ }
      }
      nativeLoop = requestAnimationFrame(scanFrame);
    };
    nativeLoop = requestAnimationFrame(scanFrame);
    return;
  }

  if (!window.ZXingBrowser?.BrowserMultiFormatReader) throw new Error('Le lecteur de codes-barres n’a pas pu être chargé.');
  const reader = new window.ZXingBrowser.BrowserMultiFormatReader(undefined, {
    delayBetweenScanAttempts: 250,
    delayBetweenScanSuccess: 1200,
  });
  zxingControls = await reader.decodeFromConstraints(constraints, video, (result) => {
    if (result?.getText()) onResult(result.getText());
  });
  activeTrack = video.srcObject?.getVideoTracks?.()[0] || null;
  onState({ engine: 'zxing', torch: hasTorch() });
}

function hasTorch() {
  try { return Boolean(activeTrack?.getCapabilities?.().torch); } catch { return false; }
}

export async function toggleTorch() {
  if (!hasTorch()) return false;
  torchEnabled = !torchEnabled;
  await activeTrack.applyConstraints({ advanced: [{ torch: torchEnabled }] });
  return torchEnabled;
}

export async function stopScanner() {
  if (nativeLoop) cancelAnimationFrame(nativeLoop);
  nativeLoop = 0;
  if (zxingControls) {
    try { zxingControls.stop(); } catch { /* déjà arrêté */ }
    zxingControls = null;
  }
  if (nativeStream) nativeStream.getTracks().forEach((track) => track.stop());
  nativeStream = null;
  if (activeTrack) {
    try { activeTrack.stop(); } catch { /* déjà arrêté */ }
  }
  activeTrack = null;
  torchEnabled = false;
}
