export const REMOTION_VERSION = "4.0.507" as const;

export const PREVIEW_SINGLETON_MODULES = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "remotion",
] as const;

export const SERVER_ONLY_PACKAGE_PREFIXES = [
  "@remotion/bundler",
  "@remotion/cli",
  "@remotion/renderer",
  "@remotion/studio",
  "@remotion/enable-scss",
  "sharp",
] as const;

export const ULTIMATE_BROWSER_CAPABILITY_PACKAGES = [
  "@react-three/drei",
  "@react-three/fiber",
  "@react-three/postprocessing",
  "@remotion/animated-emoji",
  "@remotion/animation-utils",
  "@remotion/captions",
  "@remotion/effects",
  "@remotion/fonts",
  "@remotion/gif",
  "@remotion/google-fonts",
  "@remotion/layout-utils",
  "@remotion/lottie",
  "@remotion/media",
  "@remotion/media-utils",
  "@remotion/motion-blur",
  "@remotion/noise",
  "@remotion/paths",
  "@remotion/preload",
  "@remotion/rive",
  "@remotion/rough-notation",
  "@remotion/rounded-text-box",
  "@remotion/sfx",
  "@remotion/shapes",
  "@remotion/skia",
  "@remotion/three",
  "@remotion/transitions",
  "@remotion/web-renderer",
  "@remotion/whisper-web",
  "@remotion/zod-types",
  "@shopify/react-native-skia",
  "@turf/turf",
  "cannon-es",
  "chart.js",
  "d3",
  "echarts",
  "lottie-web",
  "maath",
  "maplibre-gl",
  "matter-js",
  "mediabunny",
  "postprocessing",
  "react-chartjs-2",
  "simplex-noise",
  "three",
  "three-stdlib",
] as const;

export function getBarePackageRoot(specifier: string): string {
  if (specifier.startsWith("node:")) return specifier;
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}

export function isServerOnlyPreviewImport(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  const root = getBarePackageRoot(specifier);
  return SERVER_ONLY_PACKAGE_PREFIXES.some((pkg) => root === pkg);
}

export function getCapabilityReport() {
  return {
    remotionVersion: REMOTION_VERSION,
    architecture: "single-project-dual-executor" as const,
    preview: {
      engine: "esbuild-browser-plus-remotion-player",
      singletonModules: PREVIEW_SINGLETON_MODULES,
      browserCreativePackages: ULTIMATE_BROWSER_CAPABILITY_PACKAGES,
      verifiedInBuildEnvironment: {
        basicBundle: true,
        threeBundle: true,
        skiaBundle: true,
        playerMount: true,
        sharedStaticFileAsset: true,
        chatgptHostAfterDeployment: false,
      },
    },
    render: {
      engine: "remotion-bundler-plus-renderer",
      packages: ["@remotion/bundler", "@remotion/renderer"],
      verifiedInBuildEnvironment: {
        pngStill: true,
        h264Media: true,
        threeTrue3dStill: true,
        skiaStill: true,
        sharedStaticFileAsset: true,
      },
    },
    storage: {
      projectRevisions: true,
      filesystemPersistenceAdapter: true,
      binaryAssetStore: true,
      streamedAssetReads: true,
    },
  };
}
