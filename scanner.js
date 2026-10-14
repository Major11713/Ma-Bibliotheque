let stream = null;
let frame = 0;
let controls = null;
let activeTrack = null;
let torchEnabled = false;
let generation = 0;

async function supportsNativeEan() {
  if (!('BarcodeDetector' in window) || !BarcodeDetector.getSupportedFormats) return false;
  try { return (await BarcodeDetector.getSupportedFormats()).includes('ean_13'); }
  catch { return false; }
}

export async function startScanner(video, onResult, onState = () => {}) {
  stopScanner();
  const ticket = generation;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('La caméra n’est pas disponible dans ce navigateur.');
  const native = await supportsNativeEan();
  if (ticket !== generation) return false;
  const acquired = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
  });
  if (ticket !== generation) {
    acquired.getTracks().forEach(track => track.stop());
    return false;
  }
  stream = acquired;
  activeTrack = acquired.getVideoTracks()[0] || null;
  video.srcObject = acquired;
  try {
    await video.play();
    if (ticket !== generation) return false;
    if (native) {
      const detector = new BarcodeDetector({ formats: ['ean_13'] });
      let lastAttempt = 0;
      const scanFrame = async time => {
        if (ticket !== generation) return;
        if (time - lastAttempt > 220 && video.readyState >= 2) {
          lastAttempt = time;
          try {
            const results = await detector.detect(video);
            if (ticket === generation && results[0]?.rawValue) onResult(results[0].rawValue);
          } catch {}
        }
        if (ticket === generation) frame = requestAnimationFrame(scanFrame);
      };
      onState({ engine: 'native', torch: hasTorch() });
      frame = requestAnimationFrame(scanFrame);
    } else {
      if (!window.ZXingBrowser?.BrowserMultiFormatReader) throw new Error('Le lecteur de codes-barres n’a pas pu être chargé.');
      const reader = new window.ZXingBrowser.BrowserMultiFormatReader(undefined, {
        delayBetweenScanAttempts: 250, delayBetweenScanSuccess: 1200
      });
      const pendingControls = await reader.decodeFromStream(acquired, video, result => {
        if (ticket === generation && result?.getText()) onResult(result.getText());
      });
      if (ticket !== generation) { pendingControls.stop(); return false; }
      controls = pendingControls;
      onState({ engine: 'zxing', torch: hasTorch() });
    }
    return true;
  } catch (error) {
    acquired.getTracks().forEach(track => track.stop());
    if (ticket !== generation) return false;
    stopScanner();
    throw error;
  }
}

function hasTorch() {
  try { return Boolean(activeTrack?.getCapabilities?.().torch); } catch { return false; }
}

export async function toggleTorch() {
  if (!hasTorch()) return false;
  const next = !torchEnabled;
  await activeTrack.applyConstraints({ advanced: [{ torch: next }] });
  torchEnabled = next;
  return torchEnabled;
}

export function stopScanner() {
  generation++;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  if (controls) { try { controls.stop(); } catch {} }
  controls = null;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  activeTrack = null;
  torchEnabled = false;
}
