#!/usr/bin/env python3
import json
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "error": "Usage: trafilatura_extract.py <url>"}))
        return 1

    url = sys.argv[1]

    try:
        import trafilatura
    except ModuleNotFoundError:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "Python package 'trafilatura' is not installed. Install it with `python -m pip install trafilatura`.",
                }
            )
        )
        return 1

    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        print(json.dumps({"ok": False, "error": f"Trafilatura could not download {url}."}))
        return 1

    extracted = trafilatura.extract(
        downloaded,
        url=url,
        output_format="json",
        with_metadata=True,
        favor_precision=True,
        include_comments=False,
        include_tables=True,
        deduplicate=True,
    )

    if not extracted:
        print(json.dumps({"ok": False, "error": f"Trafilatura could not extract readable text from {url}."}))
        return 1

    try:
        payload = json.loads(extracted)
    except json.JSONDecodeError:
        print(json.dumps({"ok": False, "error": "Trafilatura returned invalid JSON."}))
        return 1

    text = " ".join(str(payload.get("text", "")).split())
    title = payload.get("title")
    hostname = payload.get("hostname")
    date = payload.get("date")

    if not text:
        print(json.dumps({"ok": False, "error": f"No extracted text was returned for {url}."}))
        return 1

    print(
        json.dumps(
            {
                "ok": True,
                "url": url,
                "title": title if isinstance(title, str) and title.strip() else None,
                "siteName": hostname if isinstance(hostname, str) and hostname.strip() else None,
                "publishedAt": date if isinstance(date, str) and date.strip() else None,
                "contentText": text,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
