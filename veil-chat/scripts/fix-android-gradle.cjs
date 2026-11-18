const { readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const plugin = require.resolve('@react-native/gradle-plugin/package.json', {
  paths: [dirname(require.resolve('react-native/package.json'))],
});
const settings = join(dirname(plugin), 'settings.gradle.kts');
const source = readFileSync(settings, 'utf8');
const incompatible = 'id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0")';
const compatible = 'id("org.gradle.toolchains.foojay-resolver-convention").version("1.0.0")';

// Gradle 9 removed IBM_SEMERU, which the older toolchain resolver references.
if (source.includes(incompatible)) {
  writeFileSync(settings, source.replace(incompatible, compatible));
}
