from pathlib import Path
from urllib.parse import urljoin, urlparse, unquote
import argparse
import re
import sys

import requests
from bs4 import BeautifulSoup


PAGES = [
    "https://www.hskcourse.com/new-hsk-vocabulary-lists/",
    "https://mandarinbean.com/new-hsk-vocabulary/",
    "https://sishumandarin.com/blog/2020/4/12/essential-hsk-vocabulary-words-levels-1-6-pdf-file",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/120 Safari/537.36"
    )
}


def safe_filename(name):
    """Remove characters that are invalid in Windows filenames."""
    name = unquote(name).split("?")[0].split("#")[0]
    name = Path(name).name or "hsk_vocabulary.pdf"
    name = re.sub(r'[<>:"/\\|?*]', "_", name)

    if not name.lower().endswith(".pdf"):
        name += ".pdf"

    return name


def find_pdf_links(page_url):
    """Find PDF links on a webpage."""
    response = requests.get(page_url, headers=HEADERS, timeout=30)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    pdf_links = set()

    for link in soup.find_all("a", href=True):
        href = link["href"].strip()
        full_url = urljoin(page_url, href)

        if ".pdf" in urlparse(full_url).path.lower():
            pdf_links.add(full_url)

    return sorted(pdf_links)


def download_file(url, output_folder):
    filename = safe_filename(url)
    destination = output_folder / filename

    # Avoid overwriting an existing file with the same name
    counter = 1
    original_destination = destination

    while destination.exists():
        destination = output_folder / (
            f"{original_destination.stem}_{counter}"
            f"{original_destination.suffix}"
        )
        counter += 1

    print(f"Downloading: {url}")

    response = requests.get(
        url,
        headers=HEADERS,
        timeout=60,
        stream=True,
    )
    response.raise_for_status()

    with open(destination, "wb") as file:
        for chunk in response.iter_content(chunk_size=1024 * 64):
            if chunk:
                file.write(chunk)

    print(f"Saved to: {destination}")


def main():
    parser = argparse.ArgumentParser(
        description="Download HSK vocabulary PDFs."
    )
    parser.add_argument(
        "folder",
        nargs="?",
        help="Folder where the PDFs should be saved",
    )
    args = parser.parse_args()

    if args.folder:
        output_folder = Path(args.folder).expanduser()
    else:
        output_folder = Path.home() / "Downloads" / "HSK_Vocabulary"

    output_folder.mkdir(parents=True, exist_ok=True)

    all_pdf_links = set()

    for page in PAGES:
        print(f"\nSearching: {page}")

        try:
            links = find_pdf_links(page)
            print(f"Found {len(links)} PDF link(s).")
            all_pdf_links.update(links)
        except requests.RequestException as error:
            print(f"Could not read page: {error}")

    if not all_pdf_links:
        print("\nNo PDF links were found.")
        print(
            "The websites may have changed their page structure or "
            "require JavaScript."
        )
        sys.exit(1)

    print(f"\nTotal unique PDFs found: {len(all_pdf_links)}")
    print(f"Destination folder: {output_folder.resolve()}\n")

    successful = 0

    for pdf_url in sorted(all_pdf_links):
        try:
            download_file(pdf_url, output_folder)
            successful += 1
        except requests.RequestException as error:
            print(f"Failed to download {pdf_url}")
            print(f"Reason: {error}\n")

    print(
        f"\nFinished. Downloaded {successful} of "
        f"{len(all_pdf_links)} file(s)."
    )


if __name__ == "__main__":
    main()
