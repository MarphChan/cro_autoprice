"""Run SenseVoiceSmall locally; emit one machine-readable result for the Node server."""

import json
import pathlib
import re
import subprocess
import sys
import tempfile


def main():
    model_dir, audio_path, ffmpeg = sys.argv[1:]
    from funasr import AutoModel

    model = AutoModel(model=model_dir, device="cpu", disable_update=True)
    with tempfile.TemporaryDirectory(prefix="innostar-sensevoice-wav-") as directory:
        subprocess.run(
            [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-i", audio_path, "-vn", "-ac", "1", "-ar", "16000",
                "-f", "segment", "-segment_time", "20",
                "-c:a", "pcm_s16le", str(pathlib.Path(directory) / "part-%05d.wav"),
            ],
            check=True,
            timeout=120,
        )
        parts = sorted(pathlib.Path(directory).glob("part-*.wav"))
        if not parts:
            raise RuntimeError("录音没有可识别的音频片段")
        texts = []
        for part in parts:
            result = model.generate(input=str(part), language="auto", use_itn=True)
            text = " ".join(str(item.get("text", "")) for item in result)
            text = re.sub(r"<\|[^|]*\|>", "", text).strip()
            if text:
                texts.append(text)
    print("SENSEVOICE_RESULT:" + json.dumps("\n".join(texts), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
