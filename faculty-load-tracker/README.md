# Faculty Load Tracker

```
faculty-load-tracker/
├── backend/
│   └── Code.gs              <- paste into Google Apps Script (NOT hosted on GitHub Pages)
└── frontend/                <- this is the website
    ├── index.html           <- login page
    ├── dashboard.html       <- counts per campus
    ├── receive.html         <- receive a document + print slip
    ├── documents.html       <- list, search, update status, release
    ├── css/
    │   └── style.css
    └── js/
        ├── config.js        <- put your Apps Script URL here (only file to edit)
        ├── tailwind-config.js
        ├── api.js           <- talks to the backend
        ├── ui.js            <- shared helpers + navigation bar
        ├── login.js
        ├── dashboard.js
        ├── receive.js
        └── documents.js
```

## Setup
1. Backend: paste `backend/Code.gs` into Apps Script, run `setupSheets`, then Deploy > New deployment > Web app
   (Execute as: Me, Access: Anyone). Copy the /exec URL.
2. Frontend: paste that URL into `frontend/js/config.js`.
3. Test locally: open `frontend/index.html` in a browser. Default login: Admin / 1234 (change it with addUser()).
4. GitHub Pages: Pages can only publish the repo root or a folder named `docs`.
   Either rename `frontend` to `docs`, or upload the contents of `frontend` to the repo root.
