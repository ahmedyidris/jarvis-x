import { apiFetch } from "@/lib/api"
import { blobToWav } from "@/lib/wav"

export async function transcribeAudio(blob: Blob, language = "ar"): Promise<string> {
  const wav = await blobToWav(blob)
  const fd = new FormData()
  fd.append("audio", wav, "speech.wav")
  const res = await apiFetch(`/api/transcribe?language=${encodeURIComponent(language)}`, {
    method: "POST",
    body: fd,
  })
  const data = await res.json()
  return data.text ?? ""
}
