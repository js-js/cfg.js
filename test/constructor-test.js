var assert = require('assert');
var esprima = require('esprima');
var ir = require('cfg-ir');
var cfg = require('../');

var fixtures = require('./fixtures');
var strip = fixtures.strip;
var equalLines = fixtures.equalLines;

describe('CFG.js', function() {
  function test(name, input, expected, options) {
    it('should ' + name, function() {
      var ast = esprima.parse(
          input.toString().replace(/^function.*{|}$/g, '')
      );

      if (options && options.global === false)
        ast.type = 'Brogram';

      var out = cfg.construct(ast);
      var str = out.map(function(cfg) {
        return ir.stringify(cfg);
      }).join('\n----\n');

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
      @a = literal %undefined # 0
      @a = literal %1 # 2
      i11 = literal %2 # 6
      @a = binary %"+", i9, i11 # 4
      i19 = literal %undefined # 0
      i20 = ret i19 # 0
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
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @a = literal %1 # 2
      i14 = branch i13 # 4
    block B1 -> B3
      @b = literal %1 # 9
    block B2 -> B3
      @b = literal %2 # 13
    block B3
      i26 = literal %undefined # 0
      i27 = ret i26 # 0
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
    ret(b);
  }, function() {/*
    block B0 -> B1, B2
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @a = literal %1 # 2
      i14 = branch i13 # 3
    block B1 -> B3
      @b = literal %1 # 7
    block B2 -> B3
      @b = literal %2 # 10
    block B3
      i24 = loadGlobal %"ret" # 13
      i27 = pushArg i26 # 12
      i28 = global # 12
      i30 = call i24, i28, %1 # 12
      i32 = literal %undefined # 0
      i33 = ret i32 # 0
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
      @a = literal %undefined # 0
      i3 = literal %undefined # 0
      @x = fn %"B1" # 1
      i14 = storeContext %0, %0, i3 # 0
      @a = literal %1 # 6
      i23 = branch i22 # 7
    block B2 -> B4
      i25 = literal %1 # 11
      i27 = storeContext %0, %0, i25 # 10
    block B3 -> B4
      i29 = literal %2 # 14
      i31 = storeContext %0, %0, i29 # 13
    block B4
      i34 = global # 17
      i36 = call i33, i34, %0 # 17
      i44 = literal %undefined # 0
      i45 = ret i44 # 0
    ----
    block B1
      i5 = loadContext %1, %0 # 4
      i6 = ret i5 # 3
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
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i11 = literal %42 # 6
      i13 = binary %"<", i9, i11 # 4
      i14 = branch i13 # 3
    block B5 -> B1
      i18 = literal %1 # 10
      @i = binary %"+", i16, i18 # 8
    block B6
      i26 = literal %undefined # 0
      i27 = ret i26 # 0
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
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B6
    block B3 -> B5
    block B4 -> B5, B2
      i11 = literal %42 # 6
      i13 = binary %"<", i9, i11 # 4
      i14 = branch i13 # 3
    block B5 -> B1
      i18 = literal %1 # 10
      @i = binary %"+", i16, i18 # 8
    block B6
      i26 = literal %undefined # 0
      i27 = ret i26 # 0
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
      @i = literal %undefined # 0
      @j = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B12
    block B3 -> B4
    block B4 -> B5, B2
      i15 = literal %42 # 6
      i17 = binary %"<", i13, i15 # 4
      i18 = branch i17 # 3
    block B5 -> B8
      @j = literal %0 # 9
    block B6 -> B8
    block B7 -> B11
    block B8 -> B9
    block B9 -> B10, B7
      i26 = literal %42 # 13
      i28 = binary %"<", i24, i26 # 11
      i29 = branch i28 # 10
    block B10 -> B6
      i33 = literal %1 # 18
      @i = binary %"+", i31, i33 # 16
      i41 = literal %1 # 22
      @j = binary %"+", i39, i41 # 20
    block B11 -> B1
    block B12
      i49 = literal %undefined # 0
      i50 = ret i49 # 0
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
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B9
    block B2 -> B13
    block B3 -> B4
    block B4 -> B5, B2
      i11 = literal %42 # 6
      i13 = binary %"<", i9, i11 # 4
      i14 = branch i13 # 3
    block B5 -> B6, B7
      i18 = literal %1 # 11
      @i = binary %"+", i16, i18 # 9
      i26 = literal %21 # 15
      i28 = binary %"<", i24, i26 # 13
      i29 = branch i28 # 12
    block B6 -> B9
    block B7 -> B8
    block B8 -> B10, B11
      i33 = literal %40 # 20
      i35 = binary %">", i31, i33 # 18
      i36 = branch i35 # 17
    block B9 -> B3
    block B10 -> B13
    block B11 -> B12
    block B12 -> B1
    block B13 -> B14
    block B14
      i40 = literal %undefined # 0
      i41 = ret i40 # 0
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
      @j = literal %undefined # 0
      @i = literal %undefined # 0
      @j = literal %1 # 2
      @i = literal %0 # 5
    block B1 -> B3
      i34 = literal %1 # 17
      @i = binary %"+", i32, i34 # 15
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i19 = literal %42 # 8
      i21 = binary %"<", i17, i19 # 6
      i22 = branch i21 # 3
    block B5 -> B1
      i26 = literal %2 # 14
      @j = binary %"*", i24, i26 # 12
    block B6
      i42 = literal %undefined # 0
      i43 = ret i42 # 0
  */}, {
    global: false
  });

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
      i4 = literal %undefined # 0
      i5 = ret i4 # 0
  */});

  test('just member assign', function() {
    a.b = 1;
  }, function() {/*
    block B0
      i1 = literal %1 # 3
      i3 = literal %"b" # 2
      i5 = loadGlobal %"a" # 4
      i6 = storeProperty i5, i3, i1 # 2
      i7 = ret i1 # 3
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
      i10 = ret i1 # 3
  */});

  test('just computed member assign', function() {
    a[b] = 1;
  }, function() {/*
    block B0
      i1 = literal %1 # 3
      i3 = loadGlobal %"b" # 4
      i5 = loadGlobal %"a" # 5
      i6 = storeProperty i5, i3, i1 # 2
      i7 = ret i1 # 3
  */});

  test('just logical expression', function() {
    a || b && c;
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
      i14 = ret i2 # 2
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
    i++;
  }, function() {/*
    block B0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i10 = nop i9 # 4
      i13 = literal %1 # 4
      @i = binary %"+", i10, i13 # 4
      i18 = literal %undefined # 0
      i19 = ret i18 # 0
  */}, {
    global: false
  });

  test('just prefix update expression', function() {
    var i = 0;
    ++i;
  }, function() {/*
    block B0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i11 = literal %1 # 4
      @i = binary %"+", i9, i11 # 4
      i17 = literal %undefined # 0
      i18 = ret i17 # 0
  */}, {
    global: false
  });

  test('member postfix update expression', function() {
    a.b++;
  }, function() {/*
    block B0
      i1 = literal %"b" # 3
      i3 = loadGlobal %"a" # 4
      i4 = loadProperty i3, i1 # 3
      i5 = nop i4 # 2
      i8 = literal %1 # 2
      i9 = binary %"+", i5, i8 # 2
      i10 = storeProperty i3, i1, i9 # 2
      i11 = ret i5 # 2
  */});

  test('member prefix update expression', function() {
    ++a.b;
  }, function() {/*
    block B0
      i1 = literal %"b" # 3
      i3 = loadGlobal %"a" # 4
      i4 = loadProperty i3, i1 # 3
      i6 = literal %1 # 2
      i8 = binary %"+", i4, i6 # 2
      i9 = storeProperty i3, i1, i8 # 2
      i10 = ret i8 # 2
  */});

  test('just postfix global update expression', function() {
    i++;
  }, function() {/*
    block B0
      i1 = loadGlobal %"i" # 3
      i2 = nop i1 # 2
      i5 = literal %1 # 2
      i6 = binary %"+", i2, i5 # 2
      i8 = storeGlobal %"i", i6 # 2
      i9 = ret i2 # 2
  */});

  test('just postfix context update expression', function() {
    var i;
    function test() {
      i++;
    }
  }, function() {/*
    block B0
      i1 = literal %undefined # 0
      @test = fn %"B1" # 1
      i21 = storeContext %0, %0, i1 # 0
      i27 = literal %undefined # 0
      i28 = ret i27 # 0
    ----
    block B1
      i3 = loadContext %1, %0 # 5
      i4 = nop i3 # 4
      i7 = literal %1 # 4
      i8 = binary %"+", i4, i7 # 4
      i10 = storeContext %1, %0, i8 # 4
      i16 = literal %undefined # 1
      i17 = ret i16 # 1
  */}, {
    global: false
  });

  test('just new expression', function() {
    new Proto(1, 2, 3);
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
      i13 = ret i12 # 2
  */});

  test('just call expression', function() {
    fn(1, 2, 3);
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
      i14 = ret i13 # 2
  */});

  test('just unary operation', function() {
    var i = 0;
    -i;
  }, function() {/*
    block B0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i11 = unary %"-", i9 # 4
      i13 = literal %undefined # 0
      i14 = ret i13 # 0
  */}, {
    global: false
  });

  test('global delete', function() {
    delete a;
  }, function() {/*
    block B0
      i1 = deleteGlobal %"a" # 2
      i2 = ret i1 # 2
  */});

  test('member delete', function() {
    var a;
    delete a.b;
  }, function() {/*
    block B0
      @a = literal %undefined # 0
      i5 = literal %"b" # 3
      i8 = deleteProperty i7, i5 # 3
      i10 = literal %undefined # 0
      i11 = ret i10 # 0
  */}, {
    global: false
  });

  test('just sequence', function() {
    (a, b, c);
  }, function() {/*
    block B0
      i1 = loadGlobal %"a" # 3
      i3 = loadGlobal %"b" # 4
      i5 = loadGlobal %"c" # 5
      i6 = ret i5 # 5
  */});

  test('just array', function() {
    [1, 2, 3];
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
      i17 = ret i1 # 2
  */});

  test('just object', function() {
    ({ a: 1, 2: x });
  }, function() {/*
    block B0
      i1 = object %2 # 2
      i3 = literal %"a" # 2
      i5 = literal %1 # 3
      i6 = storeProperty i1, i3, i5 # 2
      i8 = literal %2 # 2
      i10 = loadGlobal %"x" # 4
      i11 = storeProperty i1, i8, i10 # 2
      i12 = ret i1 # 2
  */});

  test('empty block', function() {
  }, function() {/*
    block B0
      i1 = literal %undefined # 0
      i2 = ret i1 # 0
  */});

  test('just a conditional expression', function() {
    a ? b : c;
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
      i10 = ret i2 # 2
  */});

  test('just an anonymous function expression', function() {
    (function() {
      return 1;
    })()
  }, function() {/*
    block B0
      i4 = fn %"B1" # 3
      i5 = global # 2
      i7 = call i4, i5, %0 # 2
      i8 = ret i7 # 2
    ----
    block B1
      i1 = literal %1 # 6
      i2 = ret i1 # 5
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
      i57 = fn %"B1" # 1
      i59 = storeGlobal %"a", i57 # 0
      i61 = loadGlobal %"a" # 28
      i63 = literal %1 # 29
      i65 = literal %2 # 30
      i67 = literal %3 # 31
      i68 = pushArg i67 # 27
      i69 = pushArg i65 # 27
      i70 = pushArg i63 # 27
      i71 = global # 27
      i73 = call i61, i71, %3 # 27
      i74 = ret i73 # 27
    ----
    block B1 -> B2, B3
      @b = loadArg %0 # 1
      @c = loadArg %1 # 1
      @d = loadArg %2 # 1
      i12 = self # 6
      i14 = literal %0 # 7
      i16 = literal %0 # 8
      i18 = literal %0 # 9
      i19 = pushArg i18 # 5
      i20 = pushArg i16 # 5
      i21 = pushArg i14 # 5
      i22 = global # 5
      i24 = call i12, i22, %3 # 5
      i26 = literal %0 # 10
      i28 = binary %"<", i24, i26 # 4
      i29 = branch i28 # 3
    block B2
      i31 = literal %0 # 15
      i35 = binary %"-", i31, i33 # 14
      i39 = binary %"-", i35, i37 # 13
      i43 = binary %"-", i39, i41 # 12
      i44 = ret i43 # 11
    block B3 -> B4
    block B4
      i50 = binary %"+", i46, i48 # 21
      i54 = binary %"+", i50, i52 # 20
      i55 = ret i54 # 19
  */});

  test('just a this expression', function() {
    this.a;
  }, function() {/*
    block B0
      i1 = literal %"a" # 2
      i2 = this # 3
      i3 = loadProperty i2, i1 # 2
      i4 = ret i3 # 2
  */});

  test('call with context', function() {
    a.b();
  }, function() {/*
    block B0
      i1 = literal %"b" # 3
      i3 = loadGlobal %"a" # 4
      i4 = loadProperty i3, i1 # 3
      i6 = call i4, i3, %0 # 2
      i7 = ret i6 # 2
  */});

  test('function with no return', function() {
    function test(a) {
      a;
    }
  }, function() {/*
    block B0
      i10 = fn %"B1" # 1
      i12 = storeGlobal %"test", i10 # 0
      i14 = literal %undefined # 0
      i15 = ret i14 # 0
    ----
    block B1
      @a = loadArg %0 # 1
      i7 = literal %undefined # 1
      i8 = ret i7 # 1
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
      i44 = fn %"B1" # 1
      i46 = storeGlobal %"run", i44 # 0
      i48 = loadGlobal %"run" # 22
      i49 = global # 21
      i51 = call i48, i49, %0 # 21
      i52 = ret i51 # 21
    ----
    block B1 -> B4
      @x = literal %undefined # 1
      @i = literal %undefined # 1
      @x = literal %1 # 4
      @i = literal %0 # 7
    block B2 -> B4
      i33 = nop i32 # 15
      i36 = literal %1 # 15
      @i = binary %"+", i33, i36 # 15
    block B3 -> B7
    block B4 -> B5
    block B5 -> B6, B3
      i19 = literal %10 # 10
      i21 = binary %"<", i17, i19 # 8
      i22 = branch i21 # 5
    block B6 -> B2
      @x = binary %"+", i24, i26 # 12
      block B7
      i42 = ret i41 # 17
  */});

  test('just context regression', function() {
    function outer() {
      var x;
      return function inner() {
        return x;
      }
    }
  }, function() {/*
    block B0
      @outer = fn %"B1" # 1
      i14 = literal %undefined # 0
      i15 = ret i14 # 0
    ----
    block B1
      i1 = literal %undefined # 1
      i3 = storeContext %0, %0, i1 # 1
      i5 = fn %"B0" # 5
      i6 = ret i5 # 4
    ----
    block B0
      i1 = loadContext %1, %0 # 5
      i2 = ret i1 # 5
  */}, {
    global: false
  });
});
