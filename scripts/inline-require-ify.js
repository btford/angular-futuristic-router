var falafel = require('falafel');
var through = require('through');
var fs = require('fs');

module.exports = function (file) {
  var data = '',
      stream = through(write, end);

  return stream;

  function write(buf) {
    data += buf;
  }

  function end() {
    var result = inlineIfy(data);
    stream.queue(result);
    stream.queue(null);
  }
};

/*
 * lets you pass custom things into a require'd module's scope
 * TODO: rename
 */
function inlineIfy (src) {
  return falafel(src, function (node) {
    if (node.type === 'CallExpression' && node.callee.name === 'require') {
      node.update(node.callee.source() + '(' + args(node, ['$q']) + ')');
    }
  });
}

function args (node, mods) {
  return node.arguments.map(function (node) {
    return node.source();
  }).concat(mods).join(', ');
}

