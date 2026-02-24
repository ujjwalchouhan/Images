# Image Pipeline (GitHub-based)

Optimize images (AVIF + WebP) → output to folder → manifest. Push to GitHub and serve via jsDelivr or raw URLs.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Add images anywhere under Images/ (any subfolders)
# e.g. Images/Aucto/image1.png, Images/projects/hero.jpg

# 3. Run the pipeline (no API keys needed)
npm run images:sync
```

## Folder structure

```
img-handler/
├── Images/
│   ├── (your folders)/   ← Put images here (jpg, jpeg, png, webp)
│   ├── optimized/        ← Output: AVIF + WebP (commit & push to GitHub)
│   ├── image-manifest.json   ← Generated manifest with URLs
│   └── .image-cache.json     ← Hash cache (gitignored)
├── scripts/
│   └── image-pipeline.js
└── package.json
```

## GitHub setup

1. **Run the pipeline** — optimized images go to `Images/optimized/`
2. **Commit and push** to GitHub:
   ```bash
   git add Images/optimized Images/image-manifest.json
   git commit -m "Add optimized images"
   git push
   ```
3. **Add base URL** to `.env` for manifest URLs:
   ```
   IMAGES_BASE_URL=https://cdn.jsdelivr.net/gh/YOUR_USERNAME/YOUR_REPO@main/img-handler/Images/optimized
   ```
   Replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub user and repo name.

4. **Re-run the pipeline** — manifest will now have full CDN URLs

## Optional: Copy manifest to React project

Add to `.env`:

```
REACT_MANIFEST_OUTPUT=../portfolio-website/src/data/image-manifest.json
```

## Usage in React

```js
import { getImage } from './utils/getImage';

function Hero() {
  const { avif, webp } = getImage('Aucto_image1');
  return (
    <picture>
      <source srcSet={avif} type="image/avif" />
      <source srcSet={webp} type="image/webp" />
      <img src={webp} alt="Hero" />
    </picture>
  );
}
```

## Features

- Recursive scan of `Images/` (all subfolders, except optimized)
- Sharp optimization: AVIF (q50) + WebP (q75), metadata stripped
- No external service — store images in GitHub
- jsDelivr CDN for fast delivery (free)
- Hash-based cache to skip unchanged images
