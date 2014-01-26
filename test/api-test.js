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
      var str = out.map(function(cfg) {
        return ir.stringify(cfg);
      }).join('\n');

      var exp = expected.toString().replace(/^function.*{\/\*|\*\/}$/g, '');
      assert.equal(strip(str), strip(exp));
    });
  }

  test('linear flow', function() {
    var a = 1;
    a += 2;
    return a;
  }, function() {/*
    block B0
      @a = literal %undefined # 0
      @a = literal %1 # 2
      i6 = literal %2 # 6
      @a = binary %"+", @a, i6 # 4
      i10 = ret @a # 7
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
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @a = literal %1 # 2
      i7 = branch @a # 4
    block B1 -> B3
      @b = literal %1 # 9
    block B2 -> B3
      @b = literal %2 # 13
    block B3
      i13 = ret @b # 14
  */});

  test('if/else with var', function() {
    var a = 1;
    if (a) {
      var b = 1;
    } else {
      var b = 2;
    }
    return b;
  }, function() {/*
    block B0 -> B1, B2
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @a = literal %1 # 2
      i7 = branch @a # 3
    block B1 -> B3
      @b = literal %1 # 7
    block B2 -> B3
      @b = literal %2 # 10
    block B3
      i13 = ret @b # 11
  */});

  test('if/else with context var', function() {
    var a = 1;
    if (a) {
      var b = 1;
    } else {
      var b = 2;
    }
    function x() {
      return b;
    }
    return x();
  }, function() {/*
    block B0 -> B2, B3
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @x = fn %"B1" # 1
      @a = literal %1 # 6
      i13 = branch @a # 7
    block B2 -> B4
      i15 = literal %1 # 11
      i18 = storeContext %0, %0, i15 # 10
    block B3 -> B4
      i20 = literal %2 # 14
      i23 = storeContext %0, %0, i20 # 13
    block B4
      i25 = global # 17
      i27 = call @x, i25, %0 # 17
      i28 = ret i27 # 16
    block B1
      i6 = loadContext %1, %0 # 4
      i7 = ret i6 # 3
  */});

  test('just while', function() {
    var i = 0;
    while (i < 42)
      i += 1;
    return i;
  }, function() {/*
    block B0 -> B3
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i6 = literal %42 # 6
      i8 = binary %"<", @i, i6 # 4
      i9 = branch i8 # 3
    block B5 -> B1
      i12 = literal %1 # 10
      @i = binary %"+", @i, i12 # 8
    block B6
      i16 = ret @i # 11
  */});

  test('just do while', function() {
    var i = 0;
    do
      i += 1;
    while (i < 42);
    return i;
  }, function() {/*
    block B0 -> B3
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B6
    block B3 -> B5
    block B4 -> B5, B2
      i6 = literal %42 # 6
      i8 = binary %"<", @i, i6 # 4
      i9 = branch i8 # 3
    block B5 -> B1
      i12 = literal %1 # 10
      @i = binary %"+", @i, i12 # 8
    block B6
      i16 = ret @i # 11
  */});

  test('nested while', function() {
    var i = 0;
    while (i < 42) {
      var j = 0;
      while (j < 42) {
        i += 1;
        j += 1;
      }
    }
    return i;
  }, function() {/*
    block B0 -> B3
      @i = literal %undefined # 0
      @j = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B12
    block B3 -> B4
    block B4 -> B5, B2
      i8 = literal %42 # 6
      i10 = binary %"<", @i, i8 # 4
      i11 = branch i10 # 3
    block B5 -> B8
      @j = literal %0 # 9
    block B6 -> B8
    block B7 -> B11
    block B8 -> B9
    block B9 -> B10, B7
      i16 = literal %42 # 13
      i18 = binary %"<", @j, i16 # 11
      i19 = branch i18 # 10
    block B10 -> B6
      i22 = literal %1 # 18
      @i = binary %"+", @i, i22 # 16
      i27 = literal %1 # 22
      @j = binary %"+", @j, i27 # 20
    block B11 -> B1
    block B12
      i31 = ret @i # 23
  */});

  test('while with break/continue', function() {
    var i = 0;
    while (i < 42) {
      i += 1;
      if (i < 21)
        continue;
      if (i > 40)
        break;
    }
    return i;
  }, function() {/*
    block B0 -> B3
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B9
    block B2 -> B13
    block B3 -> B4
    block B4 -> B5, B2
      i6 = literal %42 # 6
      i8 = binary %"<", @i, i6 # 4
      i9 = branch i8 # 3
    block B5 -> B6, B7
      i12 = literal %1 # 11
      @i = binary %"+", @i, i12 # 9
      i17 = literal %21 # 15
      i19 = binary %"<", @i, i17 # 13
      i20 = branch i19 # 12
    block B6 -> B9
    block B7 -> B8
    block B8 -> B10, B11
      i23 = literal %40 # 20
      i25 = binary %">", @i, i23 # 18
      i26 = branch i25 # 17
    block B9 -> B3
    block B10 -> B13
    block B11 -> B12
    block B12 -> B1
    block B13 -> B14
    block B14
      i28 = ret @i # 22
  */});

  test('just for', function() {
    var j = 1;
    for (var i = 0; i < 42; i += 1) {
      j = j * 2;
    }
    return j;
  }, function() {/*
    block B0 -> B3
      @j = literal %undefined # 0
      @i = literal %undefined # 0
      @j = literal %1 # 2
      @i = literal %0 # 5
    block B1 -> B3
      i21 = literal %1 # 17
      @i = binary %"+", @i, i21 # 15
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i10 = literal %42 # 8
      i12 = binary %"<", @i, i10 # 6
      i13 = branch i12 # 3
    block B5 -> B1
      i16 = literal %2 # 14
      @j = binary %"*", @j, i16 # 12
    block B6
      i25 = ret @j # 18
  */});

  test('empty for', function() {
    for (;;);
  }, function() {/*
    block B0 -> B3
    block B1 -> B3
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i1 = literal %true # 1
      i2 = branch i1 # 1
    block B5 -> B1
    block B6
  */});

  test('just member assign', function() {
    a.b = 1;
  }, function() {/*
    block B0
      i1 = literal %1 # 3
      i3 = literal %"b" # 2
      i5 = loadGlobal %"a" # 4
      i6 = storeProperty i5, i3, i1 # 2
  */});

  test('just double member assign', function() {
    a.b.c = 1;
  }, function() {/*
    block B0
      i1 = literal %1 # 3
      i3 = literal %"c" # 2
      i5 = literal %"b" # 4
      i7 = loadGlobal %"a" # 5
      i8 = loadProperty i7, i5 # 4
      i9 = storeProperty i8, i3, i1 # 2
  */});

  test('just computed member assign', function() {
    a[b] = 1;
  }, function() {/*
    block B0
      i1 = literal %1 # 3
      i3 = loadGlobal %"b" # 4
      i5 = loadGlobal %"a" # 5
      i6 = storeProperty i5, i3, i1 # 2
  */});

  test('just logical expression', function() {
    return a || b && c;
  }, function() {/*
    block B0 -> B1, B2
      i1 = loadGlobal %"a" # 3
      i3 = branch i1 # 2
    block B1 -> B3
      i4 = to_phi i2, i1 # 2
    block B2 -> B4, B5
      i6 = loadGlobal %"b" # 5
      i8 = branch i6 # 4
    block B3
      i2 = phi # 2
      i14 = ret i2 # 1
    block B4 -> B6
      i11 = loadGlobal %"c" # 6
      i12 = to_phi i7, i11 # 4
    block B5 -> B6
      i9 = to_phi i7, i6 # 4
    block B6 -> B3
      i7 = phi # 4
      i13 = to_phi i2, i7 # 2
  */});

  test('just postfix update expression', function() {
    var i = 0;
    return i++;
  }, function() {/*
    block B0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i5 = nop @i # 4
      i8 = literal %1 # 4
      @i = binary %"+", i5, i8 # 4
      i10 = ret i5 # 3
  */});

  test('just prefix update expression', function() {
    var i = 0;
    return ++i;
  }, function() {/*
    block B0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i6 = literal %1 # 4
      @i = binary %"+", @i, i6 # 4
      i9 = ret @i # 3
  */});

  test('member postfix update expression', function() {
    return a.b++;
  }, function() {/*
    block B0
      i1 = literal %"b" # 3
      i3 = loadGlobal %"a" # 4
      i4 = loadProperty i3, i1 # 3
      i5 = nop i4 # 2
      i8 = literal %1 # 2
      i9 = binary %"+", i5, i8 # 2
      i10 = storeProperty i3, i1, i9 # 2
      i11 = ret i5 # 1
  */});

  test('member prefix update expression', function() {
    return ++a.b;
  }, function() {/*
    block B0
      i1 = literal %"b" # 3
      i3 = loadGlobal %"a" # 4
      i4 = loadProperty i3, i1 # 3
      i6 = literal %1 # 2
      i8 = binary %"+", i4, i6 # 2
      i9 = storeProperty i3, i1, i8 # 2
      i10 = ret i8 # 1
  */});

  test('just new expression', function() {
    return new Proto(1, 2, 3);
  }, function() {/*
    block B0
      i1 = loadGlobal %"Proto" # 3
      i3 = literal %1 # 4
      i5 = literal %2 # 5
      i7 = literal %3 # 6
      i8 = pushArg i7 # 2
      i9 = pushArg i5 # 2
      i10 = pushArg i3 # 2
      i12 = new i1, %3 # 2
      i13 = ret i12 # 1
  */});

  test('just call expression', function() {
    return fn(1, 2, 3);
  }, function() {/*
    block B0
      i1 = loadGlobal %"fn" # 3
      i3 = literal %1 # 4
      i5 = literal %2 # 5
      i7 = literal %3 # 6
      i8 = pushArg i7 # 2
      i9 = pushArg i5 # 2
      i10 = pushArg i3 # 2
      i11 = global # 2
      i13 = call i1, i11, %3 # 2
      i14 = ret i13 # 1
  */});

  test('just unary operation', function() {
    var i = 0;
    return -i;
  }, function() {/*
    block B0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i6 = unary %"-", @i # 4
      i7 = ret i6 # 3
  */});

  test('global delete', function() {
    delete a;
  }, function() {/*
    block B0
      i1 = deleteGlobal %"a" # 2
  */});

  test('member delete', function() {
    var a;
    delete a.b;
  }, function() {/*
    block B0
      @a = literal %undefined # 0
      i3 = literal %"b" # 3
      i5 = deleteProperty @a, i3 # 3
  */});

  test('just sequence', function() {
    return (a, b, c);
  }, function() {/*
    block B0
      i1 = loadGlobal %"a" # 3
      i3 = loadGlobal %"b" # 4
      i5 = loadGlobal %"c" # 5
      i6 = ret i5 # 1
  */});

  test('just array', function() {
    return [1, 2, 3];
  }, function() {/*
    block B0
      i1 = array %3 # 2
      i3 = literal %1 # 3
      i5 = literal %0 # 2
      i6 = storeProperty i1, i5, i3 # 2
      i8 = literal %2 # 4
      i10 = literal %1 # 2
      i11 = storeProperty i1, i10, i8 # 2
      i13 = literal %3 # 5
      i15 = literal %2 # 2
      i16 = storeProperty i1, i15, i13 # 2
      i17 = ret i1 # 1
  */});

  test('just object', function() {
    return { a: 1, 2: x };
  }, function() {/*
    block B0
      i1 = object %2 # 2
      i3 = literal %"a" # 2
      i5 = literal %1 # 3
      i6 = storeProperty i1, i3, i5 # 2
      i8 = literal %2 # 2
      i10 = loadGlobal %"x" # 4
      i11 = storeProperty i1, i8, i10 # 2
      i12 = ret i1 # 1
  */});

  test('empty return', function() {
    return;
  }, function() {/*
    block B0
      i1 = literal %undefined # 1
      i2 = ret i1 # 1
  */});

  test('just a conditional expression', function() {
    return a ? b : c;
  }, function() {/*
    block B0 -> B1, B2
      i1 = loadGlobal %"a" # 3
      i3 = branch i1 # 2
    block B1 -> B3
      i5 = loadGlobal %"b" # 4
      i6 = to_phi i2, i5 # 2
    block B2 -> B3
      i8 = loadGlobal %"c" # 5
      i9 = to_phi i2, i8 # 2
    block B3
      i2 = phi # 2
      i10 = ret i2 # 1
  */});

  test('just a function declaration', function() {
    return a(1, 2, 3);
    function a(b, c, d) {
      if (a(0, 0, 0) < 0)
        return 0 - b - c - d;
      return b + c + d;
    }
  }, function() {/*
    block B0
      @a = fn %"B1" # 1
      i48 = literal %1 # 28
      i50 = literal %2 # 29
      i52 = literal %3 # 30
      i53 = pushArg i52 # 26
      i54 = pushArg i50 # 26
      i55 = pushArg i48 # 26
      i56 = global # 26
      i58 = call @a, i56, %3 # 26
      i59 = ret i58 # 25
    block B1 -> B2, B3
      @b = loadArg %0 # 1
      @c = loadArg %1 # 1
      @d = loadArg %2 # 1
      i6 = self # 6
      i8 = literal %0 # 7
      i10 = literal %0 # 8
      i12 = literal %0 # 9
      i13 = pushArg i12 # 5
      i14 = pushArg i10 # 5
      i15 = pushArg i8 # 5
      i16 = global # 5
      i18 = call i6, i16, %3 # 5
      i20 = literal %0 # 10
      i22 = binary %"<", i18, i20 # 4
      i23 = branch i22 # 3
    block B2
      i25 = literal %0 # 15
      i28 = binary %"-", i25, @b # 14
      i31 = binary %"-", i28, @c # 13
      i34 = binary %"-", i31, @d # 12
      i35 = ret i34 # 11
    block B3 -> B4
    block B4
      i39 = binary %"+", @b, @c # 21
      i42 = binary %"+", i39, @d # 20
      i43 = ret i42 # 19
  */});

  test('just a function expression', function() {
    return (function a(b, c, d) {
      if (a(0, 0, 0) < 0)
        return 0 - b - c - d;
      return b + c + d;
    })(1, 2, 3);
  }, function() {/*
    block B0
      i45 = fn %"B1" # 3
      i47 = literal %1 # 27
      i49 = literal %2 # 28
      i51 = literal %3 # 29
      i52 = pushArg i51 # 2
      i53 = pushArg i49 # 2
      i54 = pushArg i47 # 2
      i55 = global # 2
      i57 = call i45, i55, %3 # 2
      i58 = ret i57 # 1
    block B1 -> B2, B3
      @b = loadArg %0 # 3
      @c = loadArg %1 # 3
      @d = loadArg %2 # 3
      i6 = self # 8
      i8 = literal %0 # 9
      i10 = literal %0 # 10
      i12 = literal %0 # 11
      i13 = pushArg i12 # 7
      i14 = pushArg i10 # 7
      i15 = pushArg i8 # 7
      i16 = global # 7
      i18 = call i6, i16, %3 # 7
      i20 = literal %0 # 12
      i22 = binary %"<", i18, i20 # 6
      i23 = branch i22 # 5
    block B2
      i25 = literal %0 # 17
      i28 = binary %"-", i25, @b # 16
      i31 = binary %"-", i28, @c # 15
      i34 = binary %"-", i31, @d # 14
      i35 = ret i34 # 13
    block B3 -> B4
    block B4
      i39 = binary %"+", @b, @c # 23
      i42 = binary %"+", i39, @d # 22
      i43 = ret i42 # 21
  */});

  test('just a this expression', function() {
    return this.a;
  }, function() {/*
    block B0
      i1 = literal %"a" # 2
      i2 = this # 3
      i3 = loadProperty i2, i1 # 2
      i4 = ret i3 # 1
  */});

  test('call with context', function() {
    return a.b();
  }, function() {/*
    block B0
      i1 = literal %"b" # 3
      i3 = loadGlobal %"a" # 4
      i4 = loadProperty i3, i1 # 3
      i6 = call i4, i3, %0 # 2
      i7 = ret i6 # 1
  */});
});
