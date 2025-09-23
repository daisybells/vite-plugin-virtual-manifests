# vite-plugin-virtual-manifests

A zero-dependency Vite plugin that generates JSON manifests based on the contents of a specified file path or directory.

This plugin is useful for creating dynamic manifests, such as asset lists or configuration files, that are automatically updated during development and cached on disk during build process.

## Features

-   **Live Updating File Lists**: Automatically list files within an array.
-   **Virtual Module Imports**: Import generated data directly from a virtual environment as opposed to reading `.json` files on disk.
-   **Transform Manifests Based on Apply Context**: Edit the manifest depending on if you are in your dev server or building the manifest (e.g. if `.png` files convert to `.webp` files during build).

## Installation

```
# Using npm
npm install vite-plugin-virtual-manifests --save-dev
```

```
# Using yarn
yarn add vite-plugin-virtual-manifests --dev
```

```
# Using pnpm
pnpm add -D vite-plugin-virtual-manifests
```

## Basic Usage

1. Add the plugin to your `vite.config.js` or `vite.config.ts`.

2. Configure a `manifests` array with a `name`, a `generate` function, and a `watchDir`.

`vite.config.js`

```
import { defineConfig } from 'vite';
import viteVirtualManifests from 'vite-plugin-virtual-manifests';
import path from 'node:path';
import fs from "node:fs/promises"

// Example generator function
async function generateAssetManifest(directory) {
  const assets = [];
  const files = await fs.readdir(directory);

  for (const file of files) {
    assets.push({
      path: path.join(directory, file),
      name: file,
    });
  }
  return assets;
}

export default defineConfig({
  plugins: [
    viteVirtualManifests({
      manifests: [
        {
          name: 'assets',
          watchDir: 'public/assets',
          generate: generateAssetManifest,
        },
      ],
    }),
  ],
});
```

### Using the Manifest

You can then import the generated manifest as a virtual module within your application code:

```
import assetsManifest from `virtual:manifests/assets`;
console.log(assetsManifest);
// Output will be the JSON data returned by your generator function.
```

## Configuration Options

The plugin is configured with a single `options` object.

`viteVirtualManifests(options)`

| **Option**        | **Type**        | **Default**                             | **Description**                                                |
| ----------------- | --------------- | --------------------------------------- | -------------------------------------------------------------- |
| `outputDirectory` | `string`        | `path.join(proces.cwd(), ".manifests")` | The directory where manifests will be cached to disk.          |
| `cacheManifests`  | `boolean`       | `true`                                  | When `true`, manifests are saved to disk during build process. |
| `manifests`       | `Array<Object>` | `(required)`                            | An array of manifest configurations.                           |

`options.manifests`

**Type**: `Array<Object>`
**Required**

An array of manifest configuration objects.

| **Option**    | **Type**                  | **Default**  | **Description**                                                                                                                                |
| ------------- | ------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string`                  | `(required)` | The name of the manifest, used for virtual module imports (e.g., `virtual:manifests/<name>`)                                                   |
| `watchDir`    | `string`                  | `null`       | The directory to watch for changes. Changes will trigger a manifest regeneration and a full page reload in dev mode.                           |
| `generate`    | `Function`                | `(required)` | A callback function that revieves the watchDir and returns the JSON data to be written to the manifest. It can be synchronous or asynchronous. |
| `watchIgnore` | `string \| Array<string>` | `[]`         | A file path or array of file paths to ignore when watching for changes. Useful for ignoring specific files within a watched directory.         |
| `transform`   | `Object`                  | `null`       | Options instrunctions to transform the manifest's JSON data.                                                                                   |

`options.manifests[].transform`

**Type**: `Object`

JSON Transform configuration

| **Option**      | **Type**             | **Default**  | **Description**                                                                                                                                                  |
| --------------- | -------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apply`         | `"serve" \| "build"` | `(optional)` | Defines when the transform function should be applied. If omitted, the transform will be applied in both development (`serve`) and build (`build`) environments. |
| `jsonTransform` | `Function`           | `(optional)` | A callback function that receives the generated JSON data and returns the transformed data.                                                                      |

### Example Transform

```
// vite.config.js
import { defineConfig } from "vite";
import viteVirtualManifests from "vite-plugin-virtual-manifests"
import fs from "node:fs/promises"
import path from "node:path";

async function generateImageManifest(directory) {
  const images = await fs.readdir(directory, { withFileTypes: true });
  return images
    .filter(fileData => fileData.isFile() && [".png", ".jpg", ".jpeg"].includes(path.extname(fileData.name.toLowerCase())))
    .map(fileData => ({
      name: fileData.name,
      path: `${path.join(path.basename(directory), fileData.name)},
    }))
}

function changePngToWebp(jsonData) {
  return jsonData.map(image => {
    return {...image, webpPath: image.path.replace(/\.(png|jpg|jpeg)/giu, ".webp")}
  })
}

export default defineConfig({
  plugins: [
    viteVirtualManifests({
      manifests: [
        {
          name: "images",
          watchDir: path.resolve(__dirname, "public/images"),
          generate: generateImageManifest,
          transform: {
            apply: "build",
            jsonTransform: changePngToWebp
          }
        }
      ]
    })
  ]
})
```

## License

This project is licensed under the MIT License.
