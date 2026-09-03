#!/usr/bin/env python3
"""Minimal bridge around NVIDIA's official Riva Python client."""

import os
import sys

import riva.client


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: asr_bridge.py <audio-file>")
    api_key = os.environ.get("NVIDIA_API_KEY")
    function_id = os.environ.get("NVIDIA_NVCF_FUNCTION_ID")
    if not api_key or not function_id:
        raise SystemExit("NVIDIA ASR credentials were not provided")

    auth = riva.client.Auth(
        uri="grpc.nvcf.nvidia.com:443",
        use_ssl=True,
        metadata_args=[
            ["function-id", function_id],
            ["authorization", f"Bearer {api_key}"],
        ],
    )
    service = riva.client.ASRService(auth)
    config = riva.client.StreamingRecognitionConfig(
        config=riva.client.RecognitionConfig(
            language_code=os.environ.get("NVIDIA_ASR_LANGUAGE", "en-US"),
            max_alternatives=1,
            enable_automatic_punctuation=True,
            verbatim_transcripts=True,
        ),
        interim_results=False,
    )

    transcripts = []
    with riva.client.AudioChunkFileIterator(sys.argv[1], 1600, None) as chunks:
        for response in service.streaming_response_generator(audio_chunks=chunks, streaming_config=config):
            for result in response.results:
                if result.is_final and result.alternatives:
                    text = result.alternatives[0].transcript.strip()
                    if text:
                        transcripts.append(text)
    print(" ".join(transcripts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
