#!/bin/bash
#cd node_modules/router
#npm install
#gulp build_source_cjs

mkdir -p dist
browserify router.js -o dist/router.js
