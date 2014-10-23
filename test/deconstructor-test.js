var assert = require('assert');
var escodegen = require('escodegen');
var ir = require('ssa-ir');
var ssa = require('../');

var fixtures = require('./fixtures');
var strip = fixtures.strip;
var equalLines = fixtures.equalLines;

describe('SSA.js/Deconstructor', function() {
  function test(name, input, expected, options) {
    it('should ' + name, function() {
      var repr = ir.parse(
          input.toString().replace(/^function.*{\/\*|\*\/}$/g, '')
      );

      var str = escodegen.generate(ssa.deconstruct(repr, options));

      var exp = expected.toString().replace(/^function.*{|}$/g, '');
      equalLines(strip(str), strip(exp));
    });
  }

  test('global scope returning expression', function() {/*
    block B0
      i1 = literal %1
      i2 = literal %2
      i3 = binary %"+", i1, i2
      ret i3
  */}, function() {
    1 + 2;
  });

  test('expression with the same literal in two inputs', function() {/*
    block B0
      i1 = literal %1
      i2 = binary %"+", i1, i1
      ret i2
  */}, function() {
    1 + 1;
  });

  test('call expression', function() {/*
    block B0
      i1 = loadGlobal %"fn" # 3
      i4 = literal %1 # 4
      i6 = literal %2 # 5
      i8 = literal %3 # 6
      i9 = pushArg i8 # 2
      i10 = pushArg i6 # 2
      i11 = pushArg i4 # 2
      i12 = global # 2
      i14 = call i1, i12, %3 # 2
      i15 = ret i14 # 2
  */}, function() {
    fn(1, 2, 3);
  });
});
