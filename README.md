# Pipeline

A lightweight networking-platform prototype for exploring how resume details can become an editable professional profile.

## Run locally

Open `index.html` in a browser, or start a local static server from this folder:

```sh
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Prototype interactions

- Upload a PDF, DOCX, or TXT resume and review structured sections and entries before using the details on your profile.
- Edit, approve, reject, or add profile details. Review state is saved in browser local storage.
- Send and withdraw suggested connection requests, save roles, search suggested people, and explore the dashboard.
- Browse the Opportunities tab: search, filter by location, type, and industry, sort, bookmark, view details, and post jobs or group collaborations (saved in local storage). The "Your Network" sections and "Explore Connections" links use sample Grid data and are labeled as unverified prototype data; "I'm Interested" is stored only in your browser.

Resume extraction happens in the browser. PDF.js preserves positioned text, font size, and font-weight signals; JSZip reads DOCX paragraph, run, style, spacing, indentation, and table structure. The parser stores normalized section and entry JSON separately from the review UI, while retaining source lines and uncertain text for confirmation. Scanned image-only PDFs still need OCR, and unusual layouts may require manual review. Uploaded files are processed locally and are not sent to a server.
