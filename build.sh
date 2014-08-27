#!/bin/bash
#cd node_modules/router
#npm install
#gulp build_source_cjs

mkdir -p dist
browserify router.js -g ./scripts/inline-require-ify.js -g ./scripts/dollar-q-ify.js -o dist/router.js
node scripts/replacePrelude.js
