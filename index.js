import path from "node:path";
import fs from "node:fs/promises";

const VIRTUAL_MODULE_PREFIX = "virtual:manifests/";
const RESOLVED_VIRTUAL_MODULE_PREFIX = `\0${VIRTUAL_MODULE_PREFIX}`;

const defaultOptions = {
    outputDirectory: ".manifests",
    cacheManifests: true,
    rootDirectory: null,
};

/**
 * Callback function that generates JSON data.
 * @callback generator
 * @param {string} directory - Directory to be analyzed for manifest generation.
 * @returns {Object|Array} - JSON object to be written to the manifest file.
 *
 */

/**
 * Callack function to handle the manifest.json transform.
 * @callback transformFunction
 * @param {Object|Array} JSONData - Input JSON data to be transformed.
 * @returns {Object|Array} - Processed JSON data.
 */

/**
 *
 * Vite plugin that generates JSON manifests based off of the contents of an input
 * file path.
 * @param {Object} inputOptions - Configurable options for manifest generator.
 *
 * @param {import("node:fs").PathLike} [inputOptions.rootDirectory] - full path to root directory,
 * if different from config.root
 *
 * @param {string} [inputOptions.outputDirectory = ".manifests"] - Directory to save
 * manifests into for external use.
 * @param {Boolean} [inputOptions.cacheManifests = true] - Defines whether or not to save manifests directly to disk.
 * @param {Object[]} inputOptions.manifests - List of manifest files set to be generated as well as
 * their configuration.
 * @param {generator} inputOptions.manifests[].generate - Callback function that generates JSON data
 * from the input file path to be written to the manifest.
 *
 * @param {string} inputOptions.manifests[].name - Identification name for logs and error messages.
 * @param {string} inputOptions.manifests[].watchDir - directory to watch for changes to update
 * manifest during development.
 *
 * @param {Object} [inputOptions.manifests[].transform] - Instructions to transform module at either "serve" or "build"
 * time. Useful for filetype conversions at build time (ex. converting .png files to .webp).
 * @param {"serve" | "build"} [inputOptions.manifests[].transform.apply] - Define whether to apply module transform at
 * server time or build time.
 * @param {transformFunction} [inputOptions.manifests[].transform.jsonTransform] - Callback function that defines how
 * the JSON data should be transformed.
 *
 *
 * @returns {import("vite").Plugin} - Vite plugin object.
 */

function viteVirtualManifests(inputOptions = {}) {
    const options = {
        ...defaultOptions,
        ...inputOptions,
    };
    const { manifests, outputDirectory, cacheManifests, rootDirectory } =
        options;

    const manifestArray = Array.isArray(manifests) ? manifests : [];

    let resolvedManifests;
    let config;

    return {
        name: "vite-plugin-virtual-manifests",
        enforce: "pre",
        configResolved(resolvedConfig) {
            config = resolvedConfig;
            const { root } = resolvedConfig;
            const resolvedRoot = rootDirectory ?? root;

            resolvedManifests = manifestArray.map((manifest) => {
                const { watchDir, watchIgnore, name } = manifest;
                const ignores = watchIgnore || [];
                const ignoresArray = Array.isArray(ignores)
                    ? ignores
                    : [ignores];

                return {
                    ...manifest,
                    watchDir: watchDir
                        ? path.resolve(resolvedRoot, watchDir)
                        : null,
                    watchIgnore: ignoresArray.map((filePath) =>
                        path.resolve(resolvedRoot, filePath)
                    ),
                    output: path.resolve(
                        resolvedRoot,
                        outputDirectory,
                        `${name}.json`
                    ),
                };
            });
        },
        resolveId(id) {
            if (id.startsWith(VIRTUAL_MODULE_PREFIX))
                return `${RESOLVED_VIRTUAL_MODULE_PREFIX}${id.slice(
                    VIRTUAL_MODULE_PREFIX.length
                )}`;
            return null;
        },
        async load(id) {
            if (id.startsWith(RESOLVED_VIRTUAL_MODULE_PREFIX)) {
                const name = id.slice(RESOLVED_VIRTUAL_MODULE_PREFIX.length);

                const currentManifest = resolvedManifests.find(
                    (manifest) => manifest.name === name
                );
                if (!currentManifest)
                    this.error(
                        `Manifest with name "${name}" not found for virtual import`
                    );

                const { generate, watchDir, transform } = currentManifest;

                const data = await Promise.resolve(generate(watchDir));

                if (transform) {
                    const transformedData = transformData(
                        data,
                        transform,
                        config.command
                    );

                    return `export default ${JSON.stringify(
                        transformedData,
                        null,
                        2
                    )};`;
                }

                return `export default ${JSON.stringify(data, null, 2)};`;
            }
            return null;
        },

        async buildStart() {
            if (cacheManifests)
                await Promise.all(resolvedManifests.map(generateManifestCache));
        },
        configureServer(server) {
            const { root, publicDir } = server.config;
            const watchDirectories = resolvedManifests
                .map((manifest) => manifest.watchDir)
                .filter(Boolean)
                .toSorted();

            const watchDirectorySet = [...new Set(watchDirectories)];

            if (watchDirectorySet.length === 0) return;

            const topLevelDirectories = returnTopLevelPaths(watchDirectorySet);

            for (const directory of topLevelDirectories) {
                const isWatched =
                    directory.startsWith(publicDir) ||
                    directory.startsWith(root);
                if (!isWatched) {
                    console.log("Adding watcher");
                    server.watcher.add(directory);
                }
            }

            const handleFileChange = handleFileChangeCurry(
                server,
                resolvedManifests
            );

            server.watcher.on("add", handleFileChange);
            server.watcher.on("change", handleFileChange);
            server.watcher.on("unlink", handleFileChange);
        },
    };
}

function transformData(data, transformOptions, command) {
    const { jsonTransform, apply } = transformOptions;
    const shouldApply = apply === command || !apply;

    if (!jsonTransform || !shouldApply) return data;

    console.log(`Applying transform for "${command}" time`);

    return jsonTransform(data);
}

function handleFileChangeCurry(server, manifests) {
    return (filePath) => {
        for (const manifest of manifests) {
            const isIgnored = manifest.watchIgnore.some((ignoredPath) =>
                filePath.startsWith(ignoredPath)
            );
            const isWithinDirectory = filePath.startsWith(manifest.watchDir);

            if (!isWithinDirectory || isIgnored) continue;

            console.log(
                `\n Change detected in ${manifest.name}. Regenerating...`
            );

            const resolveId = `${RESOLVED_VIRTUAL_MODULE_PREFIX}${manifest.name}`;
            const module = server.moduleGraph.getModuleById(resolveId);
            if (!module) continue;

            server.moduleGraph.invalidateModule(module);
            server.ws.send({ type: "full-reload", path: "*" });
            console.log(
                `\n♻️ Virtual module "${VIRTUAL_MODULE_PREFIX}${manifest.name}" invalidated. Page will reload.`
            );
            return;
        }
    };
}

async function generateManifestCache(manifest) {
    const { name, watchDir, generate, output } = manifest;

    try {
        const data = await generate(watchDir);
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(output, JSON.stringify(data, null, 2));
        console.log(`\n ✅ ${name} manifest written to ${output}`);
    } catch (error) {
        console.error(`\n ❌ Error generating manifest [${name}]: ${error}`);
    }
}

function returnTopLevelPaths(filePathArray) {
    const sortedArray = filePathArray.toSorted();

    const topLevelDirectories = sortedArray.reduce(
        (accumulator, currentValue) => {
            const lastAddedDirectory = accumulator.at(-1);
            if (
                lastAddedDirectory &&
                currentValue.startsWith(`${lastAddedDirectory}${path.sep}`)
            )
                return accumulator;

            return [...accumulator, currentValue];
        },
        []
    );
    return topLevelDirectories;
}

export default viteVirtualManifests;
