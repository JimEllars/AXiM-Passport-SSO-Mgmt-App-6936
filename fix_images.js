const { Jimp } = require('jimp');

async function fixImages() {
  const img192 = new Jimp({ width: 192, height: 192, color: 0x00000000 });
  await img192.write('public/pwa-192x192.png');

  const img512 = new Jimp({ width: 512, height: 512, color: 0x00000000 });
  await img512.write('public/pwa-512x512.png');
  console.log('Images resized.');
}

fixImages().catch(console.error);
