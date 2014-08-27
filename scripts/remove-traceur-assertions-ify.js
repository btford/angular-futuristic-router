var falafel = require('falafel');

var src = '(' + function () {
    return $traceurRuntime.assertObject(foo).blah;
} + ')()';

var output = removeAssertions(src);
console.log(output);

function removeAssertions (arg) {
  return falafel(src, removeAssertionsFromNode);
}

function removeAssertionsFromNode (node) {
  if (node.type === 'CallExpression' &&
      node.callee.source() === '$traceurRuntime.assertObject') {

    // TODO: not sure if this fn is ever called with more than one arg...
    node.update(node.arguments[0].source());
  }
}
