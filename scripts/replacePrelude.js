var fs = require('fs');

var old    = read('oldPrelude');
var custom = read('customPrelude');
var src    = read('../dist/router');

var oldWrap    = 'function(require,module,exports){';
var customWrap = 'function(require,module,exports,$q){';

// hahaha
// poorest man's "replace all"
do {
  oldSrc = src;
  src = src.replace(oldWrap, customWrap);
} while (src !== oldSrc);

src = src.replace(old, custom);
fs.writeFileSync(__dirname + '/../dist/router.js', src);

function read (file) {
  return fs.readFileSync(__dirname + '/' + file + '.js', 'utf8');
}
