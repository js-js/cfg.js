var assert = require('assert');
var esprima = require('esprima');
var ir = require('ssa-ir');
var ssa = require('../');

describe('SSA.js', function() {
  function strip(source) {
    var lines = source.split(/\r\n|\r|\n/g);

    var out = lines.map(function(line) {
      return line.replace(/^\s*/, '');
    }).filter(function(line) {
      return !!line;
    });

    return out.join('\n');
  }
  function test(name, input, expected) {
    it('should ' + name, function() {
      var ast = esprima.parse(
          'function main() {\n' +
          input.toString().replace(/^function.*{|}$/g, '') +
          '\n}'
      );
      // Hack to allow return statements
      ast.body = ast.body[0].body.body;

      var out = ssa.construct(ast);
      var exp = expected.toString().replace(/^function.*{\/\*|\*\/}$/g, '');
      assert.equal(strip(ir.stringify(out)), strip(exp));
    });
  }

  test('linear flow', function() {
    var a = 1;
    a = a + 2;
    return a;
  }, function() {/*
    block B0
      @a = literal %undefined
      @a = literal %1
      i6 = literal %2
      @a = binary %"+", @a, i6
      i10 = ret @a
  */});

  test('just if/else', function() {
    var a = 1;
    var b;
    if (a) {
      b = 1;
    } else {
      b = 2;
    }
    return b;
  }, function() {/*
    block B0 -> B1, B2
      @a = literal %undefined
      @b = literal %undefined
      @a = literal %1
      i7 = branch @a
    block B1 -> B3
      @b = literal %1
    block B2 -> B3
      @b = literal %2
    block B3
      i13 = ret @b
  */});

  test('just while', function() {
    var i = 0;
    while (i < 42)
      i = i + 1;
    return i;
  }, function() {/*
    block B0 -> B1
      @i = literal %undefined
      @i = literal %0
    block B1 -> B2, B4
      i6 = literal %42
      i8 = binary %"<", @i, i6
      i9 = branch i8
    block B2 -> B3
      i12 = literal %1
      @i = binary %"+", @i, i12
    block B3 -> B1
    block B4
      i16 = ret @i
  */});

  test('nested while', function() {
    var i = 0;
    while (i < 42) {
      var j = 0;
      while (j < 42) {
        i = i + 1;
        j = j + 1;
      }
    }
    return i;
  }, function() {/*
    block B0 -> B1
      @i = literal %undefined
      @j = literal %undefined
      @i = literal %0
    block B1 -> B2, B4
      i8 = literal %42
      i10 = binary %"<", @i, i8
      i11 = branch i10
    block B2 -> B5
      @j = literal %0
    block B3 -> B1
    block B4
      i31 = ret @i
    block B5 -> B6, B8
      i16 = literal %42
      i18 = binary %"<", @j, i16
      i19 = branch i18
    block B6 -> B7
      i22 = literal %1
      @i = binary %"+", @i, i22
      i27 = literal %1
      @j = binary %"+", @j, i27
    block B7 -> B5
    block B8 -> B3
  */});

  test('just for', function() {
    var j = 1;
    for (var i = 0; i < 42; i = i + 1) {
      j = j * 2;
    }
    return j;
  }, function() {/*
    block B0 -> B1
      @j = literal %undefined
      @i = literal %undefined
      @j = literal %1
      @i = literal %0
    block B1 -> B2, B4
      i10 = literal %42
      i12 = binary %"<", @i, i10
      i13 = branch i12
    block B2 -> B3
      i16 = literal %2
      @j = binary %"*", @j, i16
    block B3 -> B1
      i21 = literal %1
      @i = binary %"+", @i, i21
    block B4
      i25 = ret @j
  */});
});
