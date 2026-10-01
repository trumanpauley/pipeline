# Pipeline

A lightweight networking-platform prototype for exploring how resume details can become an editable professional profile.

## Run locally

Open `index.html` in a browser, or start a local static server from this folder:

```sh
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Prototype interactions

- Upload a text-based PDF, DOCX, or TXT resume and review the extracted details.
- Edit, approve, reject, or add profile details. Review state is saved in browser local storage.
- Send and withdraw suggested connection requests, save roles, search suggested people, and explore the dashboard.

Resume extraction happens in the browser using PDF.js and Mammoth. Scanned image-only PDFs and advanced resume layouts need OCR or a more robust parsing service; this prototype keeps uploaded files private and does not send them to a server.
