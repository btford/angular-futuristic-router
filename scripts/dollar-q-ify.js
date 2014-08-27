var falafel = require('falafel');
var through = require('through');


module.exports = function (file) {
  var data = '',
      stream = through(write, end);

  return stream;

  function write(buf) {
    data += buf;
  }

  function end() {
    var result = dollarQify(data);
    stream.queue(result);
    stream.queue(null);
  }
}

/*
 * Replace ES6 promises with calls to $q
 *
 * note that this may not be comprehensive
 */
function dollarQify (src) {
  return falafel(src, function (node) {
    if (node.type === 'NewExpression' && node.callee.name === 'Promise') {
      node.update('$q(' + argsToSrc(node) + ')');
    } else if (node.type === 'CallExpression') {
      var callee = node.callee.source(),
          match,
          method;
      if (match = callee.match(/^Promise\.(resolve|reject|all)$/)) {
        var method = match[1];
        if (method === 'resolve') {
          method = 'when';
        }
        node.update('$q.' + method + '(' + argsToSrc(node) + ')');
      }
    }
  });
}

/*
 * given a node with arguments return the source prepresentation
 */
function argsToSrc (node) {
  return node.arguments.map(function (node) {
    return node.source();
  }).join(', ');
}
