# TrendProof

This archive includes the latest source and the matching production build.

## Open the production build

From the `trendproof` folder, run `python -m http.server 8080 --directory dist/client`. Then open `http://localhost:8080` in your browser. You can also serve `dist/client/` from a static host.

## Run or edit the source

From the `trendproof` folder, run `npm ci` and then `npm run dev`. Open the URL printed by Vite. Use `npm run build` to rebuild. See `README.md` for Node.js requirements.

Drag to rotate the globe. Click a point to look up its place name, fill the search field, and analyze temperature at the clicked coordinates. The globe pin and caption show the place name and coordinates separately. Live lookups and NASA POWER analysis require internet access. The hosted Nominatim gateway is included under `dist/server/`.

Source revision `722755899666a50a089d6515d16f7147e097a813`
