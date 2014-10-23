var assert = require('assert');
var esprima = require('esprima');
var ir = require('ssa-ir');
var ssa = require('../');

describe('SSA.js/Constructor', function() {
  function strip(source) {
    var lines = source.split(/\r\n|\r|\n/g);

    var out = lines.map(function(line) {
      return line.replace(/^\s*/, '');
    }).filter(function(line) {
      return !!line;
    });

    return out.join('\n');
  }

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

    throw new Error('SSA output mismatch:\n\n' + out + '\n' + actual);
  }

  function test(name, input, expected, options) {
    it('should ' + name, function() {
      var ast = esprima.parse(
          input.toString().replace(/^function.*{|}$/g, '')
      );

      if (options && options.global === false)
        ast.type = 'Brogram';

      var out = ssa.construct(ast);
      var str = ir.stringify(out);

      var exp = expected.toString().replace(/^function.*{\/\*|\*\/}$/g, '');
      equalLines(strip(str), strip(exp));
    });
  }

  test('linear flow', function() {
    var a = 1;
    a += 2;
    a;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      @a = literal %undefined # 0
      @a = literal %1 # 2
      i7 = literal %2 # 6
      @a = binary %"+", @a, i7 # 4
      i12 = literal %undefined # 0
      i13 = ret i12 # 0
  */}, {
    global: false
  });

  test('just if/else', function() {
    var a = 1;
    var b;
    if (a) {
      b = 1;
    } else {
      b = 2;
    }
    b;
  }, function() {/*
    block B0 -> B1, B2
      i0 = __ssa_root__ # 0
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @a = literal %1 # 2
      i8 = branch @a # 4
    block B1 -> B3
      @b = literal %1 # 9
    block B2 -> B3
      @b = literal %2 # 13
    block B3
      i15 = literal %undefined # 0
      i16 = ret i15 # 0
  */}, {
    global: false
  });

  test('if/else with var', function() {
    var a = 1;
    if (a) {
      var b = 1;
    } else {
      var b = 2;
    }
    b;
  }, function() {/*
    block B0 -> B1, B2
      i0 = __ssa_root__ # 0
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @a = literal %1 # 2
      i8 = branch @a # 3
    block B1 -> B3
      @b = literal %1 # 7
    block B2 -> B3
      @b = literal %2 # 10
    block B3
      i15 = literal %undefined # 0
      i16 = ret i15 # 0
  */}, {
    global: false
  });

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
    x();
  }, function() {/*
    block B0 -> B2, B3
      i0 = __ssa_root__ # 0
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @x = fn %"B1" # 1
      @a = literal %1 # 6
      i15 = branch @a # 7
    block B2 -> B4
      i17 = literal %1 # 11
      i20 = storeContext %0, %0, i17 # 10
    block B3 -> B4
      i22 = literal %2 # 14
      i25 = storeContext %0, %0, i22 # 13
    block B4
      i27 = global # 17
      i29 = call @x, i27, %0 # 17
      i31 = literal %undefined # 0
      i32 = ret i31 # 0
    block B1
      i5 = __ssa_root__ # 1
      i8 = loadContext %1, %0 # 4
      i9 = ret i8 # 3
  */}, {
    global: false
  });

  test('just while', function() {
    var i = 0;
    while (i < 42)
      i += 1;
    i;
  }, function() {/*
    block B0 -> B3
      i0 = __ssa_root__ # 0
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i7 = literal %42 # 6
      i9 = binary %"<", @i, i7 # 4
      i10 = branch i9 # 3
    block B5 -> B1
      i13 = literal %1 # 10
      @i = binary %"+", @i, i13 # 8
    block B6
      i18 = literal %undefined # 0
      i19 = ret i18 # 0
  */}, {
    global: false
  });

  test('just do while', function() {
    var i = 0;
    do
      i += 1;
    while (i < 42);
    i;
  }, function() {/*
    block B0 -> B3
      i0 = __ssa_root__ # 0
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B6
    block B3 -> B5
    block B4 -> B5, B2
      i7 = literal %42 # 6
      i9 = binary %"<", @i, i7 # 4
      i10 = branch i9 # 3
    block B5 -> B1
      i13 = literal %1 # 10
      @i = binary %"+", @i, i13 # 8
    block B6
      i18 = literal %undefined # 0
      i19 = ret i18 # 0
  */}, {
    global: false
  });

  test('nested while', function() {
    var i = 0;
    while (i < 42) {
      var j = 0;
      while (j < 42) {
        i += 1;
        j += 1;
      }
    }
    i;
  }, function() {/*
    block B0 -> B3
      i0 = __ssa_root__ # 0
      @i = literal %undefined # 0
      @j = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B12
    block B3 -> B4
    block B4 -> B5, B2
      i9 = literal %42 # 6
      i11 = binary %"<", @i, i9 # 4
      i12 = branch i11 # 3
    block B5 -> B8
      @j = literal %0 # 9
    block B6 -> B8
    block B7 -> B11
    block B8 -> B9
    block B9 -> B10, B7
      i17 = literal %42 # 13
      i19 = binary %"<", @j, i17 # 11
      i20 = branch i19 # 10
    block B10 -> B6
      i23 = literal %1 # 18
      @i = binary %"+", @i, i23 # 16
      i28 = literal %1 # 22
      @j = binary %"+", @j, i28 # 20
    block B11 -> B1
    block B12
      i33 = literal %undefined # 0
      i34 = ret i33 # 0
  */}, {
    global: false
  });

  test('while with break/continue', function() {
    var i = 0;
    while (i < 42) {
      i += 1;
      if (i < 21)
        continue;
      if (i > 40)
        break;
    }
    i;
  }, function() {/*
    block B0 -> B3
      i0 = __ssa_root__ # 0
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B9
    block B2 -> B13
    block B3 -> B4
    block B4 -> B5, B2
      i7 = literal %42 # 6
      i9 = binary %"<", @i, i7 # 4
      i10 = branch i9 # 3
    block B5 -> B6, B7
      i13 = literal %1 # 11
      @i = binary %"+", @i, i13 # 9
      i18 = literal %21 # 15
      i20 = binary %"<", @i, i18 # 13
      i21 = branch i20 # 12
    block B6 -> B9
    block B7 -> B8
    block B8 -> B10, B11
      i24 = literal %40 # 20
      i26 = binary %">", @i, i24 # 18
      i27 = branch i26 # 17
    block B9 -> B3
    block B10 -> B13
    block B11 -> B12
    block B12 -> B1
    block B13 -> B14
    block B14
      i30 = literal %undefined # 0
      i31 = ret i30 # 0
  */}, {
    global: false
  });

  test('just for', function() {
    var j = 1;
    for (var i = 0; i < 42; i += 1) {
      j = j * 2;
    }
    j;
  }, function() {/*
    block B0 -> B3
      i0 = __ssa_root__ # 0
      @j = literal %undefined # 0
      @i = literal %undefined # 0
      @j = literal %1 # 2
      @i = literal %0 # 5
    block B1 -> B3
      i22 = literal %1 # 17
      @i = binary %"+", @i, i22 # 15
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i11 = literal %42 # 8
      i13 = binary %"<", @i, i11 # 6
      i14 = branch i13 # 3
    block B5 -> B1
      i17 = literal %2 # 14
      @j = binary %"*", @j, i17 # 12
    block B6
      i27 = literal %undefined # 0
      i28 = ret i27 # 0
  */}, {
    global: false
  });

  test('empty for', function() {
    for (;;);
  }, function() {/*
    block B0 -> B3
      i0 = __ssa_root__ # 0
    block B1 -> B3
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i2 = literal %true # 1
      i3 = branch i2 # 1
    block B5 -> B1
    block B6
      i5 = literal %undefined # 0
      i6 = ret i5 # 0
  */});

  test('just member assign', function() {
    a.b = 1;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = literal %1 # 3
      i4 = literal %"b" # 2
      i6 = literal %"a" # 4
      i7 = loadGlobal i6 # 4
      i8 = storeProperty i7, i4, i2 # 2
      i9 = ret i2 # 3
  */});

  test('just double member assign', function() {
    a.b.c = 1;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = literal %1 # 3
      i4 = literal %"c" # 2
      i6 = literal %"b" # 4
      i8 = literal %"a" # 5
      i9 = loadGlobal i8 # 5
      i10 = loadProperty i9, i6 # 4
      i11 = storeProperty i10, i4, i2 # 2
      i12 = ret i2 # 3
  */});

  test('just computed member assign', function() {
    a[b] = 1;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = literal %1 # 3
      i4 = literal %"b" # 4
      i5 = loadGlobal i4 # 4
      i7 = literal %"a" # 5
      i8 = loadGlobal i7 # 5
      i9 = storeProperty i8, i5, i2 # 2
      i10 = ret i2 # 3
  */});

  test('just logical expression', function() {
    a || b && c;
  }, function() {/*
    block B0 -> B1, B2
      i0 = __ssa_root__ # 0
      i2 = literal %"a" # 3
      i3 = loadGlobal i2 # 3
      i5 = branch i3 # 2
    block B1 -> B3
      i6 = to_phi i4, i3 # 2
    block B2 -> B4, B5
      i8 = literal %"b" # 5
      i9 = loadGlobal i8 # 5
      i11 = branch i9 # 4
    block B3
      i4 = phi # 2
      i18 = ret i4 # 2
    block B4 -> B6
      i14 = literal %"c" # 6
      i15 = loadGlobal i14 # 6
      i16 = to_phi i10, i15 # 4
    block B5 -> B6
      i12 = to_phi i10, i9 # 4
    block B6 -> B3
      i10 = phi # 4
      i17 = to_phi i4, i10 # 2
  */});

  test('just postfix update expression', function() {
    var i = 0;
    i++;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i6 = nop @i # 4
      i9 = literal %1 # 4
      @i = binary %"+", i6, i9 # 4
      i12 = literal %undefined # 0
      i13 = ret i12 # 0
  */}, {
    global: false
  });

  test('just prefix update expression', function() {
    var i = 0;
    ++i;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i7 = literal %1 # 4
      @i = binary %"+", @i, i7 # 4
      i11 = literal %undefined # 0
      i12 = ret i11 # 0
  */}, {
    global: false
  });

  test('member postfix update expression', function() {
    a.b++;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = literal %"b" # 3
      i4 = literal %"a" # 4
      i5 = loadGlobal i4 # 4
      i6 = loadProperty i5, i2 # 3
      i7 = nop i6 # 2
      i10 = literal %1 # 2
      i11 = binary %"+", i7, i10 # 2
      i12 = storeProperty i5, i2, i11 # 2
      i13 = ret i7 # 2
  */});

  test('member prefix update expression', function() {
    ++a.b;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = literal %"b" # 3
      i4 = literal %"a" # 4
      i5 = loadGlobal i4 # 4
      i6 = loadProperty i5, i2 # 3
      i8 = literal %1 # 2
      i10 = binary %"+", i6, i8 # 2
      i11 = storeProperty i5, i2, i10 # 2
      i12 = ret i10 # 2
  */});

  test('just new expression', function() {
    new Proto(1, 2, 3);
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = literal %"Proto" # 3
      i3 = loadGlobal i2 # 3
      i5 = literal %1 # 4
      i7 = literal %2 # 5
      i9 = literal %3 # 6
      i10 = pushArg i9 # 2
      i11 = pushArg i7 # 2
      i12 = pushArg i5 # 2
      i14 = new i3, %3 # 2
      i15 = ret i14 # 2
  */});

  test('just call expression', function() {
    fn(1, 2, 3);
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = literal %"fn" # 3
      i3 = loadGlobal i2 # 3
      i5 = literal %1 # 4
      i7 = literal %2 # 5
      i9 = literal %3 # 6
      i10 = pushArg i9 # 2
      i11 = pushArg i7 # 2
      i12 = pushArg i5 # 2
      i13 = global # 2
      i15 = call i3, i13, %3 # 2
      i16 = ret i15 # 2
  */});

  test('just unary operation', function() {
    var i = 0;
    -i;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i7 = unary %"-", @i # 4
      i9 = literal %undefined # 0
      i10 = ret i9 # 0
  */}, {
    global: false
  });

  test('global delete', function() {
    delete a;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = deleteGlobal %"a" # 2
      i3 = ret i2 # 2
  */});

  test('member delete', function() {
    var a;
    delete a.b;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      @a = literal %undefined # 0
      i4 = literal %"b" # 3
      i6 = deleteProperty @a, i4 # 3
      i8 = literal %undefined # 0
      i9 = ret i8 # 0
  */}, {
    global: false
  });

  test('just sequence', function() {
    (a, b, c);
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = literal %"a" # 3
      i3 = loadGlobal i2 # 3
      i5 = literal %"b" # 4
      i6 = loadGlobal i5 # 4
      i8 = literal %"c" # 5
      i9 = loadGlobal i8 # 5
      i10 = ret i9 # 5
  */});

  test('just array', function() {
    [1, 2, 3];
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = array %3 # 2
      i4 = literal %1 # 3
      i6 = literal %0 # 2
      i7 = storeProperty i2, i6, i4 # 2
      i9 = literal %2 # 4
      i11 = literal %1 # 2
      i12 = storeProperty i2, i11, i9 # 2
      i14 = literal %3 # 5
      i16 = literal %2 # 2
      i17 = storeProperty i2, i16, i14 # 2
      i18 = ret i2 # 2
  */});

  test('just object', function() {
    ({ a: 1, 2: x });
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = object %2 # 2
      i4 = literal %"a" # 2
      i6 = literal %1 # 3
      i7 = storeProperty i2, i4, i6 # 2
      i9 = literal %2 # 2
      i11 = literal %"x" # 4
      i12 = loadGlobal i11 # 4
      i13 = storeProperty i2, i9, i12 # 2
      i14 = ret i2 # 2
  */});

  test('empty block', function() {
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = literal %undefined # 0
      i3 = ret i2 # 0
  */});

  test('just a conditional expression', function() {
    a ? b : c;
  }, function() {/*
    block B0 -> B1, B2
      i0 = __ssa_root__ # 0
      i2 = literal %"a" # 3
      i3 = loadGlobal i2 # 3
      i5 = branch i3 # 2
    block B1 -> B3
      i7 = literal %"b" # 4
      i8 = loadGlobal i7 # 4
      i9 = to_phi i4, i8 # 2
    block B2 -> B3
      i11 = literal %"c" # 5
      i12 = loadGlobal i11 # 5
      i13 = to_phi i4, i12 # 2
    block B3
      i4 = phi # 2
      i14 = ret i4 # 2
  */});

  test('just a function declaration', function() {
    function a(b, c, d) {
      if (a(0, 0, 0) < 0)
        return 0 - b - c - d;
      return b + c + d;
    }
    a(1, 2, 3);
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i47 = fn %"B1" # 1
      i49 = literal %"a" # 0
      i50 = storeGlobal i49, i47 # 0
      i52 = literal %"a" # 28
      i53 = loadGlobal i52 # 28
      i55 = literal %1 # 29
      i57 = literal %2 # 30
      i59 = literal %3 # 31
      i60 = pushArg i59 # 27
      i61 = pushArg i57 # 27
      i62 = pushArg i55 # 27
      i63 = global # 27
      i65 = call i53, i63, %3 # 27
      i66 = ret i65 # 27
    block B1 -> B2, B3
      i1 = __ssa_root__ # 1
      @b = loadArg %0 # 1
      @c = loadArg %1 # 1
      @d = loadArg %2 # 1
      i8 = self # 6
      i10 = literal %0 # 7
      i12 = literal %0 # 8
      i14 = literal %0 # 9
      i15 = pushArg i14 # 5
      i16 = pushArg i12 # 5
      i17 = pushArg i10 # 5
      i18 = global # 5
      i20 = call i8, i18, %3 # 5
      i22 = literal %0 # 10
      i24 = binary %"<", i20, i22 # 4
      i25 = branch i24 # 3
    block B2
      i27 = literal %0 # 15
      i30 = binary %"-", i27, @b # 14
      i33 = binary %"-", i30, @c # 13
      i36 = binary %"-", i33, @d # 12
      i37 = ret i36 # 11
    block B3 -> B4
    block B4
      i41 = binary %"+", @b, @c # 21
      i44 = binary %"+", i41, @d # 20
      i45 = ret i44 # 19
  */});

  test('just a this expression', function() {
    this.a;
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = literal %"a" # 2
      i3 = this # 3
      i4 = loadProperty i3, i2 # 2
      i5 = ret i4 # 2
  */});

  test('call with context', function() {
    a.b();
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i2 = literal %"b" # 3
      i4 = literal %"a" # 4
      i5 = loadGlobal i4 # 4
      i6 = loadProperty i5, i2 # 3
      i8 = call i6, i5, %0 # 2
      i9 = ret i8 # 2
  */});

  test('function with no return', function() {
    function test(a) {
      a;
    }
  }, function() {/*
    block B0
    i0 = __ssa_root__ # 0
    i9 = fn %"B1" # 1
    i11 = literal %"test" # 0
    i12 = storeGlobal i11, i9 # 0
    i14 = literal %undefined # 0
    i15 = ret i14 # 0
    block B1
    i1 = __ssa_root__ # 1
    @a = loadArg %0 # 1
    i6 = literal %undefined # 1
    i7 = ret i6 # 1
  */});

  test('function boundary regression', function() {
    function run() {
      var x = 1;
      for (var i = 0; i < 10; i++)
        x += i;
      return x;
    }
    run();
  }, function() {/*
    block B0
      i0 = __ssa_root__ # 0
      i29 = fn %"B1" # 1
      i31 = literal %"run" # 0
      i32 = storeGlobal i31, i29 # 0
      i34 = literal %"run" # 22
      i35 = loadGlobal i34 # 22
      i36 = global # 21
      i38 = call i35, i36, %0 # 21
      i39 = ret i38 # 21
    block B1 -> B4
      i1 = __ssa_root__ # 1
      @x = literal %undefined # 1
      @i = literal %undefined # 1
      @x = literal %1 # 4
      @i = literal %0 # 7
    block B2 -> B4
      i21 = nop @i # 15
      i24 = literal %1 # 15
      @i = binary %"+", i21, i24 # 15
    block B3 -> B7
    block B4 -> B5
    block B5 -> B6, B3
      i12 = literal %10 # 10
      i14 = binary %"<", @i, i12 # 8
      i15 = branch i14 # 5
    block B6 -> B2
      @x = binary %"+", @x, @i # 12
    block B7
      i27 = ret @x # 17
  */});
});
