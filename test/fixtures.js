function strip(source) {
  var lines = source.split(/\r\n|\r|\n/g);

  var out = lines.map(function(line) {
    return line.replace(/^\s*/, '');
  }).filter(function(line) {
    return !!line;
  });

  return out.join('\n');
}
exports.strip = strip;

function equalLines(actual, expected) {
  if (actual === expected)
    return;

  var actualLines = actual.split('\n');
  var expectedLines = expected.split('\n');
  var width = 0;

  expectedLines.unshift('    expected:');
  actualLines.unshift('    actual:');
  var total = Math.max(actualLines.length, expectedLines.length);

  if (actualLines.length !== total) {
    for (var i = actualLines.length; i < total; i++)
      actualLines.push('');
  } else {
    for (var i = expectedLines.length; i < total; i++)
      expectedLines.push('');
  }

  for (var i = 0; i < total; i++) {
    width = Math.max(width, actualLines[i].length);
    width = Math.max(width, expectedLines[i].length);
  }

  var out = '';
  for (var i = 0; i < total; i++) {
    var left = expectedLines[i];
    var right = actualLines[i];

    if (left !== right)
      out += '\033[31m';
    else
      out += '\033[32m';

    out += left;
    for (var j = left.length; j < width; j++)
      out += ' ';

    out += '  |  ';
    out += right;

    out += '\033[0m';

    out += '\n';
  }

  throw new Error('Output mismatch:\n\n' + out + '\n' + actual);
}
exports.equalLines = equalLines;
