export async function blobToWav(blob: Blob, sampleRate = 16000): Promise<Blob> {
  const buf = await blob.arrayBuffer()
  const ctx = new AudioContext()
  const decoded = await ctx.decodeAudioData(buf)
  await ctx.close()
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * sampleRate)), sampleRate)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  const pcm = rendered.getChannelData(0)
  const out = new ArrayBuffer(44 + pcm.length * 2)
  const view = new DataView(out)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
  w(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ")
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  w(36, "data"); view.setUint32(40, pcm.length * 2, true)
  let o = 44
  for (let i = 0; i < pcm.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([out], { type: "audio/wav" })
}
