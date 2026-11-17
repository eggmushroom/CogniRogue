# Rust 程序设计语言

> 逐章生成，未逐题人工复核。原文：《Rust 程序设计语言》中文版（MIT），
> https://github.com/rust-lang-cn/book-cn
> 重生成：npm run gen -- --src=data/sources/rust-cn-book.md --out=packs/rust-cn.md --per=20

## 入门指南

### 书中建议用哪个工具来下载并管理 Rust 的版本和相关工具？
~ 入门指南/rustup 的定位
A) rustc，Rust 编译器本身
B) rustup，一个管理 Rust 版本和相关工具的命令行工具
C) cargo，Rust 的构建系统和包管理器
D) rustfmt，自动格式化工具
= B
+ 书中开篇说明将通过 rustup 下载 Rust，它是一个管理 Rust 版本和相关工具的命令行工具。

### 按书中的说明，使用 rustup 下载 Rust 需要什么前提？
~ 入门指南/安装的前提条件
A) 需要预先安装好 Cargo
B) 需要预先安装好 Python
C) 互联网连接
D) 需要预先安装好 Git
= C
+ 书中明确指出这需要互联网连接才能下载。

### 书中说 Rust 需要一个链接器（linker），它的作用是什么？
~ 入门指南/链接器的作用
A) 把编译器产生的输出关联到一个文件中
B) 从网络下载项目依赖
C) 把 Rust 源码格式化为标准风格
D) 在运行前检查语法错误
= A
+ 链接器是 Rust 用来将其编译的输出关联到一个文件中的程序。

### 通过 rustup 安装 Rust 后，要更新到最新版本应运行哪个命令？
~ 入门指南/更新 Rust
A) rustup upgrade
B) cargo update
C) rustup update
D) rustc --update
= C
+ 书中给出的更新命令是 rustup update。

### 要卸载 Rust 和 rustup，应运行哪个命令？
~ 入门指南/卸载 Rust
A) rustup uninstall
B) cargo uninstall rustup
C) rustc --uninstall
D) rustup self uninstall
= D
+ 书中给出的卸载命令是 rustup self uninstall。

### 按书中所说，运行 rustc --version 后看到什么样的信息说明安装成功？
~ 入门指南/验证安装成功
A) 只有一行 Hello, world!
B) 形如 rustc x.y.z (abcabcabc yyyy-mm-dd) 的版本号、提交哈希值和提交日期
C) 形如 Cargo.lock 的依赖清单
D) 一个空白的终端提示符
= B
+ 看到最新稳定版本的版本号、提交哈希值和提交日期，说明已成功安装 Rust。

### 想用浏览器打开随 Rust 安装的本地文档副本，应运行哪个命令？
~ 入门指南/打开本地文档
A) cargo doc
B) rustc doc
C) rustup docs
D) rustup doc
= D
+ 书中说明运行 rustup doc 让浏览器打开本地文档。

### 书中终端示例里行首的 $ 表示什么？
~ 入门指南/命令行符号的含义
A) 该行是上一个命令的输出内容
B) 每个命令的开始，实际输入时不需输入 $
C) 该命令需要管理员权限
D) 该命令仅适用于 PowerShell
= B
+ $ 表示每个命令的开始，你不需输入 $ 字符；不以 $ 开头的行通常是上一个命令的输出。

### 按书中建议，下面哪个是正确的多词 Rust 源文件名？
~ 入门指南/Rust 源文件命名
A) helloworld.rs
B) hello-world.rs
C) hello world.rs
D) hello_world.rs
= D
+ Rust 文件通常以 .rs 结尾，文件名中多个单词应用下划线隔开，如下划线而非直接连写或连字符。

### 书中说 main 函数特殊在哪里？
~ 入门指南/main 函数的特殊性
A) 它是唯一可以调用 println! 的函数
B) 它必须带有参数和返回值
C) 它始终是每个可执行 Rust 程序中运行的第一个代码
D) 它只能定义在名为 main.rs 的文件中
= C
+ main 函数始终是每个可执行 Rust 程序中运行的第一个代码。

### 代码 println!("Hello, world!"); 中的 ! 表示什么？
~ 入门指南/宏调用的感叹号
A) 这是一个逻辑非运算
B) 该行必须被编译器忽略
C) 这里调用的是宏而不是普通函数
D) 该字符串会被插值
= C
+ 当看到一个 !，意味着调用的是宏而不是普通的函数；若是函数则应写作 println。

### 示例代码 println!("Hello, world!"); 行末的分号表示什么？
~ 入门指南/分号的作用
A) 该行是注释
B) 该表达式已结束，下一个表达式已准备好开始
C) 该宏的返回值必须被丢弃
D) 该语句处于调试模式
= B
+ 分号表明该表达式已结束，下一个表达式已准备好开始；Rust 代码的大多数行都以分号结尾。

### 在 Linux 或 macOS 上用 rustc main.rs 编译成功后，怎样运行得到的程序？
~ 入门指南/编译后运行程序
A) rustc main
B) cargo main
C) ./main
D) ./main.rs
= C
+ 编译成功后输出可执行文件 main，用 ./main 运行（Windows 上为 .\main.exe）。

### 书中说 Rust 是一门预编译（ahead-of-time compiled）语言，这意味着什么？
~ 入门指南/预编译语言的含义
A) 每次运行程序都需要先启动 Rust 解释器
B) 必须联网才能运行编译后的程序
C) 源文件会与解释器一起分发
D) 可以编译出可执行文件交给别人，即使对方没有安装 Rust 也能运行
= D
+ 预编译意味着可以编译一个程序，把编译后的可执行文件给别人，即使他们没有安装 Rust 也可以运行。

### 书中如何定位 Cargo？
~ 入门指南/Cargo 的定位
A) Rust 的官方代码格式化工具
B) Rust 的构建系统和包管理器
C) Rust 编译器的另一个名字
D) Rust 的文档生成器
= B
+ Cargo 是 Rust 的构建系统和包管理器，可处理构建代码、下载依赖库以及编译这些库等任务。

### 运行 cargo new hello_cargo 后，Cargo 在 hello_cargo 目录中生成什么？
~ 入门指南/cargo new 生成的内容
A) 只有 main.rs 一个文件
B) Cargo.lock 和 target 目录
C) Cargo.toml、src 目录（内含 main.rs），并初始化一个 Git 仓库和 .gitignore
D) 一个已编译的可执行文件
= C
+ cargo new 生成 Cargo.toml 和 src（内含 main.rs），并在目录中初始化 Git 仓库、带有 .gitignore 文件。

### Cargo.toml 中 [dependencies] 表块用来做什么？
~ 入门指南/Cargo.toml 中的 dependencies 表块
A) 设置项目名称、版本和 edition
B) 列出项目所依赖的包
C) 记录依赖的实际版本
D) 配置发布构建的优化选项
= B
+ [dependencies] 是一个表块的开头，可以在其中列出项目所依赖的任何包（crate）。

### 按 Cargo 的惯例，源文件应放在哪里，项目根目录放什么？
~ 入门指南/Cargo 的目录约定
A) 源文件放在根目录；src 只存放测试文件
B) 源文件放在 target 目录；根目录存放可执行文件
C) 源文件放在 src 目录；根目录存放 README、许可协议、配置文件等跟代码无关的文件
D) 源文件放在 Cargo.toml 同级，且与配置混在一起
= C
+ Cargo 期望源文件位于 src 目录中；项目根目录只存放说明文件、许可协议信息、配置文件和其他跟代码无关的文件。

### 相比 cargo build，cargo check 的特点是什么？
~ 入门指南/cargo check 的用途
A) 先构建再立即运行程序
B) 生成优化后的发布版本
C) 记录项目依赖的实际版本
D) 快速检查代码确保可以编译，但不产生可执行文件
= D
+ cargo check 快速检查代码确保其可以编译，但并不产生可执行文件，通常比 cargo build 快得多。

### 关于 cargo build --release，书中怎么说？
~ 入门指南/cargo build --release 的取舍
A) 它会优化编译项目，产物在 target/release 下，且编译时间更长
B) 它产物在 target/debug 下，编译更快
C) 它只检查代码不产生可执行文件
D) 它会把可执行文件生成在源码目录旁
= A
+ 发布构建会优化编译项目，在 target/release 而非 target/debug 下生成可执行文件，并消耗更长的编译时间。

## 通用编程概念

### 默认情况下 Rust 变量是不可变的。如果希望之后能重新给同一个变量赋新值，应该怎么做？
~ 变量/默认不可变性
A) 在声明时于变量名前加上 mut
B) 在声明时使用 const 代替 let
C) 在赋值语句前加上 mut
D) 把变量声明在函数体之外
= A
+ 变量默认不可变，在声明时加 mut 才能对同一变量再次赋值；mut 也向读代码的人表明该值之后会变化。

### 关于用 const 声明的常量，下列说法正确的是？
~ 常量/声明要求
A) 可以省略类型标注，由编译器推导
B) 必须标注类型，且不允许使用 mut
C) 可以使用 mut 使其可变
D) 只能声明在函数体内
= B
+ 常量必须注明类型，且自始至终不可变，不允许使用 mut；它可以在任意作用域中声明，包括全局作用域。

### 用 let 重复声明同名变量（遮蔽）与把变量标记为 mut，关键区别是什么？
~ 遮蔽/与 mut 的区别
A) 遮蔽只能用于整型，mut 可用于任意类型
B) 两者没有区别，只是写法不同
C) 遮蔽可以改变变量的类型，而 mut 不能改变变量的类型
D) 遮蔽会释放原变量占用的内存，mut 不会
= C
+ 每次使用 let 都会创建一个新变量，因此可以复用同一个名字但改变值的类型；而 mut 只允许改值，不允许改变类型。

### 如果不确定该用哪种整型，Rust 的默认整型是什么？
~ 整型/默认类型
A) u32
B) isize
C) i64
D) i32
= D
+ 整型默认是 i32；isize 和 usize 主要用于某些集合的索引。

### 在 debug 模式下编译，一个 u8 变量被赋予 256 时会发生什么？
~ 整型/溢出行为
A) 值会被包裹成 0，程序继续运行
B) 编译期直接报错拒绝编译
C) 发生 panic，因为调试模式会检查整型溢出
D) 值会被饱和为 255
= C
+ 调试模式会检查整型溢出并在发生时 panic；而 release 模式不检查，会做二进制补码包裹，例如 256 变成 0。

### Rust 中浮点数的默认类型是什么，为什么？
~ 浮点/默认类型
A) f32，因为占用空间更小
B) f64，因为现代 CPU 上它的速度与 f32 几乎相同而精度更高
C) f64，因为 f32 只能表示正数
D) f32，因为 f64 不符合 IEEE-754
= B
+ 浮点型有 f32 和 f64，默认是 f64；所有浮点型都是有符号的，均按 IEEE-754 表示。

### Rust 中的 bool 类型占用的空间是多少？
~ 布尔/大小
A) 1 个位
B) 4 个字节
C) 取决于平台
D) 1 个字节
= D
+ 布尔值只有 true 和 false 两个可能值，大小固定为 1 个字节，主要用在 if 等条件判断中。

### 关于 Rust 的 char 类型，下列描述正确的是？
~ 字符/编码与大小
A) 占 1 个字节，等价于一个 ASCII 字符
B) 占 4 个字节，表示一个 Unicode 标量值，字面量用单引号
C) 占 4 个字节，字面量用双引号
D) 占 2 个字节，采用 UTF-16 编码
= B
+ char 字面量用单引号，占 4 个字节，表示一个 Unicode 标量值，可以表示中文、emoji 等远不止 ASCII 的字符。

### 已有一个元组 let t = (1, 2.5, true);，要直接访问其中的 2.5，应该怎么写？
~ 元组/索引访问
A) t[1]
B) t(1)
C) t.get(1)
D) t.1
= D
+ 可以用句点加索引直接访问元组元素，索引从 0 开始，所以第二个元素是 t.1；也可以用模式匹配解构元组。

### 关于 Rust 的数组类型，下列说法正确的是？
~ 数组/元素类型与长度
A) 元素类型可以不同，长度固定
B) 每个元素类型必须相同，且长度固定
C) 元素类型必须相同，长度可以增长
D) 元素类型可以不同，长度可以增长
= B
+ 数组的每个元素必须具有相同的类型，且长度固定；元素类型可以不同的是元组，长度可增长的是 vector。

### 语句 let a = [3; 5]; 创建的是什么？
~ 数组/重复元素初始化
A) 包含 3 个元素、每个元素值为 5 的数组
B) 表示 3 到 5 的区间
C) 包含元素 3 和 5 的数组
D) 包含 5 个元素、每个元素值为 3 的数组
= D
+ 这种语法先给初始值，再在分号后给出长度，等价于 [3, 3, 3, 3, 3]，但更简洁。

### 用一个运行时才得到的索引去访问固定长度的数组，如果索引大于或等于数组长度会发生什么？
~ 数组/越界访问
A) 编译期报错，代码无法通过编译
B) 返回该数组的最后一个元素
C) 程序在运行时 panic，而不会访问到无效内存
D) 返回 0 并继续运行
= C
+ 这种检查只能在运行时进行，因为编译器无法预知用户输入的索引；Rust 会 panic 并立即退出，而不是允许无效的内存访问。

### 在 Rust 中定义带参数的函数时，必须做什么？
~ 函数/参数类型标注
A) 只在返回类型不是 () 时才需标注参数类型
B) 让编译器根据调用处推导参数类型
C) 只需对第一个参数标注类型
D) 在函数签名中为每个参数标注类型
= D
+ 函数签名中必须声明每个参数的类型；这一决定让编译器几乎从不需要你在其他地方注明类型来表达意图。

### 为什么 let x = (let y = 6); 这样的代码无法编译？
~ 语句/不产生值
A) 因为 y 没有标注类型
B) 因为 let 语句不返回值，没有可以绑定到 x 的值
C) 因为 let 不能写在大括号里
D) 因为 x 没有被声明为 mut
= B
+ let 语句是语句而非表达式，不产生值；不像 C 或 Ruby 中赋值会返回所赋的值，因此不能把 let 语句的结果赋给另一个变量。

### 如果在一个代码块最后一行表达式 x + 1 的末尾加上分号，会发生什么？
~ 表达式/末尾分号
A) 没有影响，代码块的值仍然是 x + 1
B) 它从表达式变成语句，代码块的值变成单元值 ()
C) 它会被当作注释的一部分
D) 编译器会自动删除这个多余的分号
= B
+ 表达式的结尾没有分号；加上分号后它就变成语句，而语句不返回值，代码块的值于是变成 ()。

### Rust 中函数的返回值是如何确定的？
~ 函数/返回值
A) 必须显式写 return 语句，否则一律返回 ()
B) 由函数名后箭头标注的类型自动推导出一个返回值
C) 函数体最后一个表达式的值即为返回值，也可以用 return 提前返回
D) 只能返回最后一条 let 语句绑定的变量
= C
+ 返回值类型在箭头 -> 后声明；大部分函数隐式返回函数体最后一个表达式的值，需要提前返回时使用 return。

### 如果 number 是整数，写 if number { ... } 会怎样？
~ if/条件必须为布尔
A) 编译通过，只要非零就视为真
B) 编译通过，但运行时会 panic
C) 只有调试模式下才会报错
D) 编译错误，条件必须是 bool 值，Rust 不会自动把非布尔值转成布尔值
= D
+ Rust 不会像某些语言那样自动转换非布尔值，if 的条件必须始终显式为 bool，例如改成 if number != 0。

### 把 if 表达式的结果赋给一个变量时，对 if 和 else 分支有什么要求？
~ if/分支类型必须相同
A) 两个分支的求值结果必须是相同类型
B) 两个分支可以有不同类型，变量类型在运行时确定
C) 两个分支必须都是没有值的语句块
D) else 分支必须省略
= A
+ 变量只能有一个类型，Rust 需要在编译期就确切知道它，因此每个分支的求值结果都必须是相同类型。

### 怎样把 loop 循环中的结果传递给循环之外的代码？
~ loop/break 返回值
A) 在 loop 之前声明的变量会在循环结束后自动携带结果
B) 在 break 后面跟一个值（如 break counter * 2），并把该 loop 表达式赋给变量
C) 使用 return 从循环返回，loop 本身不能带值
D) 在循环外使用 continue 接收结果
= B
+ break 表达式可以带上要返回的值，该值就从 loop 中返回，可用于把重试操作的结果交给后续代码。

### 在嵌套循环中，怎样让 break 退出外层循环而不是最内层循环？
~ 循环标签/跳出外层循环
A) 写 break 2; 来指定跳出层数
B) 在内层循环使用 continue 就能退出外层循环
C) 给外层循环加标签（如 'counting_up: loop），然后写 break 'counting_up;
D) 把 break 写在外层循环体的开头
= C
+ 默认 break 和 continue 作用于最内层循环；给循环加标签后配合 break 或 continue 使用，就能让它们作用于被标记的循环。

## 认识所有权

### Rust 采用哪种方式管理程序使用的内存？
~ 所有权/内存管理方式
A) 运行时由垃圾回收器不断寻找不再使用的内存
B) 由开发者手动调用分配与释放函数
C) 通过所有权系统由编译器在编译时按规则检查
D) 由操作系统在程序退出时统一回收所有内存
= C
+ 本节指出 Rust 选择第三种方式：通过所有权系统管理内存，编译器在编译时根据一系列规则检查，运行时所有权系统的任何功能都不会减慢程序。

### 关于栈存取数据的顺序，下列描述正确的是？
~ 所有权/栈的后进先出
A) 以放入值的顺序存储，也以相同顺序取出，即先进先出
B) 以放入值的顺序存储，以相反顺序取出，即后进先出
C) 栈中元素按键值大小排序后取出
D) 栈中任意位置都可以随时插入和取出
= B
+ 栈以放入值的顺序存储值并以相反顺序取出值，这被称作后进先出（last in, first out）。

### 按照本节的说法，什么样的数据要改为存储在堆上？
~ 所有权/栈与堆的存放规则
A) 在编译时大小未知或大小可能变化的数据
B) 所有实现了 Copy trait 的数据
C) 所有标量类型的数据
D) 只能被一个变量拥有的数据
= D
+ 栈中的所有数据都必须占用已知且固定的大小；在编译时大小未知或大小可能变化的数据，要改为存储在堆上。

### 为什么入栈比在堆上分配内存要快？
~ 所有权/入栈比堆分配快的原因
A) 因为栈的容量比堆大得多
B) 因为栈上的数据在编译期就被写入可执行文件
C) 入栈时分配器无需搜索内存空间，其位置总是在栈顶
D) 因为栈内存由垃圾回收器提前整理好
= C
+ 入栈时分配器无需为存储新数据去搜索内存空间，其位置总是在栈顶；而在堆上分配则需要先找到足够大的空间并做记录。

### 根据所有权规则，一个值在任一时刻可以有几个所有者？
~ 所有权规则/值只有一个所有者
A) 可以有任意多个
B) 有且只有一个
C) 可以没有所有者，直到被使用
D) 取决于值是否分配在堆上
= B
+ 所有权规则规定：值在任一时刻有且只有一个所有者。

### 当拥有堆上数据的变量离开作用域时，Rust 会做什么？
~ 所有权/离开作用域自动释放
A) 什么也不做，等待垃圾回收器处理
B) 把该值移动到最近声明的另一个变量中
C) 调用 drop 函数，自动把内存返回给分配器
D) 把值复制一份到静态内存区
= C
+ 变量离开作用域时 Rust 会自动调用 drop 函数，在这里 String 的作者放置释放内存的代码，Rust 在结尾的 } 处自动调用 drop。

### 一个 String 变量本身（如 `let s = String::from("hello");` 中的 `s`）在栈上存储的是什么？
~ 所有权/String-栈上三元组
A) 字符串的全部字节内容
B) 指向堆上内容的指针、长度和容量
C) 仅一个字符数组
D) 一个由垃圾回收器维护的句柄
= B
+ String 由三部分组成：一个指向存放字符串内容内存的指针、一个长度和一个容量，这一组数据存储在栈上，内容在堆上。

### 执行 `let s2 = s1;`（`s1` 为 String）之后，`s1` 的状态是什么？
~ 所有权/移动后原变量失效
A) 仍然有效，可以继续使用
B) 被立即释放，`s2` 指向新分配的内存
C) 被 Rust 视为不再有效，不能继续使用
D) 变为指向堆数据的可变引用
= C
+ 在 `let s2 = s1` 之后，Rust 认为 `s1` 不再有效，因此不需要在 `s1` 离开作用域后清理任何东西；这个操作被称为移动。

### 为什么 `let s2 = s1;` 之后要让 `s1` 失效？
~ 所有权/移动避免二次释放
A) 为了减少栈上的内存占用
B) 为了让 String 自动实现 Copy trait
C) 为了触发深拷贝，复制堆上的数据
D) 为了避免 `s1` 和 `s2` 都尝试释放同一块内存，造成二次释放
= D
+ 两个指针指向同一位置时，离开作用域都会尝试释放相同内存，这是二次释放错误；使 `s1` 失效后只有 `s2` 有效，从而解决问题。

### 如果需要真正复制 String 中堆上的数据，应该调用什么？
~ 所有权/克隆深拷贝
A) `copy` 方法
B) `clone` 方法
C) 解引用运算符 `*`
D) `String::from` 之前先 `drop` 原值
= B
+ 如果确实需要深度复制 String 中堆上的数据，而不仅仅是栈上的数据，可以使用 clone 通用函数，此时堆上的数据确实被复制了。

### 下列哪个类型实现了 Copy trait？
~ 所有权/copy-trait-适用范围
A) `(i32, String)`
B) `String`
C) `(i32, i32)`
D) `Vec<i32>`
= C
+ 元组当且仅当其包含的类型也都实现 Copy 时才实现 Copy，所以 `(i32, i32)` 实现了 Copy，而 `(i32, String)` 没有。

### 一个类型如果实现了 Drop trait，还能实现 Copy trait 吗？
~ 所有权/copy-与-drop-互斥
A) 能，只要它所有字段都实现了 Copy
B) 不能，这会导致编译时错误
C) 能，但只能在 unsafe 块中使用
D) 能，但运行时会在 drop 时 panic
= B
+ Rust 不允许自身或其任何部分实现了 Drop trait 的类型使用 Copy trait；对这样的类型使用 Copy 标注会出现编译时错误。

### 把一个 String 变量传给函数（参数类型为 String）后，原来的变量会怎样？
~ 所有权/传参移动或复制
A) 所有权仍然保留在原变量中，函数只是借用
B) 原变量会被自动 clone 一份给函数
C) 所有权被移动进函数，之后原变量不能再使用
D) 函数返回时所有权自动回到原变量
= C
+ 将值传递给函数在语义上与给变量赋值相似，向函数传递 String 会移动所有权，之后尝试使用原变量会得到编译时错误。

### 使用 `&s1` 创建引用后，当这个引用停止使用时，它指向的值会怎样？
~ 借用/引用不获取所有权
A) 立即被 drop 释放
B) 不会被丢弃，因为引用并不拥有它
C) 所有权转移到引用上
D) 被自动复制到另一个变量
= B
+ 引用允许你使用值但不获取其所有权；因为并不拥有这个值，所以当引用停止使用时，它所指向的值也不会被丢弃。

### 在同一时间，对同一份数据可以拥有几个可变引用？
~ 借用/可变引用唯一性
A) 只能有一个
B) 可以有两个
C) 可以有任意多个，只要都声明为 `mut`
D) 可以有两个，只要不是在同一个函数里
= A
+ 可变引用有一个很大的限制：在同一时间，只能有一个对某一特定数据的可变引用，尝试创建两个可变引用会导致编译失败。

### 在不可变引用仍然被使用的时候，能否再创建一个指向同一数据的可变引用？
~ 借用/不可变与可变引用共存
A) 能，只要可变引用不写入数据
B) 不能，编译器会报错
C) 能，只要类型实现了 Copy
D) 能，只要把不可变引用放在内层作用域
= B
+ 不能在拥有不可变引用的同时拥有可变引用；使用者不希望不可变引用的值在他们眼皮底下被改变。不过多个不可变引用是可以的。

### 一个引用的作用域从声明处开始，一直持续到什么时候？
~ 借用/引用作用域到最后一次使用
A) 一直持续到包含它的代码块结束的 `}`
B) 一直持续到程序运行结束
C) 持续到最后一次使用该引用为止
D) 持续到它所指向的值被修改为止
= C
+ 引用的作用域从声明的地方开始一直持续到最后一次使用为止，编译器在作用域结束之前判断不再使用的引用的能力被称为非词法作用域生命周期（NLL）。

### 对于让函数返回其内部局部变量的引用的写法（悬垂引用），Rust 会怎么处理？
~ 借用/悬垂引用编译期拒绝
A) 编译通过，但运行时会 panic
B) 编译通过，返回一个空指针
C) 编译通过，并自动延长局部变量的生命周期
D) 编译时报错，因为编译器要求数据不会在其引用之前离开作用域
= D
+ Rust 编译器确保引用永远不会变成悬垂状态：当你拥有一些数据的引用，编译器确保数据不会在其引用之前离开作用域，因此这类代码会编译失败。

### 若 `s` 是 String，`&s[..2]` 等价于下列哪个写法？
~ slice/range-语法省略
A) `&s[0..2]`
B) `&s[2..]`
C) `&s[0..3]`
D) `&s[1..2]`
= A
+ 如果想要从索引 0 开始，可以不写两个点号之前的值，因此 `&s[0..2]` 与 `&s[..2]` 相同。

### 把 `first_word` 的参数类型从 `&String` 改为 `&str`，好处是什么？
~ slice/&str-参数更通用
A) 可以避免任何指针的开销
B) 可以同时接受 String 的 slice 和 `&str`，API 更通用且不丢失功能
C) 可以让函数取得参数的所有权
D) 可以避免 slice 越界检查
= B
+ 定义一个获取字符串 slice 而不是 String 引用的函数，使得 API 更加通用并且不会丢失任何功能：有 slice 可以直接传递，有 String 则可以传递整个 String 的 slice 或对 String 的引用。

## 使用结构体组织关联数据

### 在 Rust 中定义结构体时，大括号内每个字段的写法是？
~ structs/definition
A) 字段名: 类型
B) 类型 字段名
C) 字段名 = 类型
D) 只写类型，字段名可省略
= A
+ 定义结构体使用 struct 关键字，在大括号中定义每一部分数据的名字和类型，形式为 字段名: 类型。

### 创建结构体实例时，为各字段提供值的顺序与结构体定义中字段的顺序是什么关系？
~ structs/instantiation
A) 必须与定义顺序完全一致
B) 不需要一致，可以任意顺序指定
C) 必须按字段名首字母排序
D) 只有最后一个字段可以提前
= B
+ 实例中字段的顺序不需要和它们在结构体中声明的顺序一致；结构体定义像模板，实例往模板里填数据。

### 要从结构体实例 user1 中读取 email 字段的值，应写成？
~ structs/field-access
A) user1.email
B) user1->email
C) user1[email]
D) user1::email
= A
+ 为了从结构体中获取某个特定的值，可以使用点号，例如 user1.email。

### 希望修改结构体实例 rect1 的某个字段，需要怎样做？
~ structs/mutability
A) 在字段定义处给该字段加 mut
B) 把实例的绑定声明为可变（let mut rect1 = ...）
C) 在字段名前加 &mut
D) Rust 不允许修改结构体字段
= B
+ 整个实例必须是可变的；Rust 并不允许只将某个字段标记为可变。

### 字段初始化简写语法（用 email 代替 email: email）在什么条件下可以使用？
~ structs/field-init-shorthand
A) 函数参数名与结构体字段名相同
B) 参数类型与字段类型相同即可
C) 字段类型实现了 Copy
D) 任何情况都可以省略字段名
= A
+ 当参数名与字段名完全相同，就可以只写字段名，省略重复的 字段名: 变量名 部分。

### 使用结构体更新语法时，`..user1` 必须放在哪里？
~ structs/struct-update-syntax
A) 必须放在最后
B) 必须放在最前
C) 可以放在任意位置
D) 只能单独写在一个 impl 块里
= A
+ ..user1 必须放在最后，以指定剩余未显式设置值的字段应从 user1 的对应字段获取值。

### 若 user1 的 username 是 String，创建 `User { email: String::from(...), ..user1 }` 之后对 user1 的影响是？
~ structs/struct-update-move
A) user1 的 username 被移动到新实例，user1 不能再使用
B) user1 被完整克隆，仍可继续使用
C) 只有 Copy 类型的字段会被移动
D) user1 被自动置为默认值
= A
+ 结构更新语法像赋值一样会移动数据；username 的 String 被移入新实例，之后不能再使用 user1。

### 定义一个名为 Color、包含三个 i32 的元组结构体，正确写法是？
~ structs/tuple-struct
A) struct Color(i32, i32, i32);
B) struct Color { i32, i32, i32 };
C) struct Color => (i32, i32, i32);
D) tuple struct Color(i32, i32, i32);
= A
+ 元组结构体以 struct 关键字和结构体名开头，后跟圆括号中的字段类型。

### Color 和 Point 都是包含三个 i32 的元组结构体。一个接受 Color 参数的函数能否接受 Point 值？
~ structs/tuple-struct-distinct-types
A) 不能，它们是不同的类型
B) 能，字段类型相同就可以
C) 能，只要先解构为元组
D) 能，但需要加 #[derive(Copy)]
= A
+ 你定义的每一个结构体有其自己的类型，即使字段类型相同，Color 和 Point 也不能互相替代。

### 定义没有任何字段的类单元结构体 AlwaysEqual，正确写法是？
~ structs/unit-like-struct
A) struct AlwaysEqual;
B) struct AlwaysEqual();
C) struct AlwaysEqual[];
D) unit struct AlwaysEqual;
= A
+ 类单元结构体用 struct 关键字、名称和分号定义，不需要花括号或圆括号；实例化同样只需名称。

### 如果结构体字段想存储 &str 字符串 slice，编译会要求什么？
~ structs/ownership-of-fields
A) 为引用添加生命周期标注
B) 把结构体声明为 mut
C) 为字段加上 #[derive(Debug)]
D) 该字段必须是 u32 类型
= A
+ 结构体存储引用时需要生命周期标注，否则编译器报 missing lifetime specifier；本节示例改用拥有所有权的 String 来避免该问题。

### 为了让 Rectangle 实例能用 {:?} 打印，需要在结构体定义前加什么？
~ structs/derive-debug
A) #[derive(Debug)]
B) #[derive(Display)]
C) #[debug]
D) impl Debug for Rectangle 以外无法实现
= A
+ Rust 不会自动为结构体提供 Debug 输出，需要在结构体定义前加上外部属性 #[derive(Debug)] 显式选择该功能。

### 为什么直接用 {} 打印结构体实例会编译失败？
~ structs/display-trait
A) 结构体默认没有实现 Display，输出格式不明确
B) 结构体没有字段时才能用 {}
C) println! 宏不支持结构体
D) 必须先手动 derive Display 才能编译
= A
+ {} 使用 Display 格式；结构体有多种显示可能，Rust 不会猜测意图，所以结构体没有提供 Display 实现。

### 与 println! 不同，调用 dbg! 宏时输出写到哪个流？
~ structs/dbg-macro-output
A) 标准错误（stderr）
B) 标准输出（stdout）
C) 一个自动创建的文件
D) 不输出，只在调试器中可见
= A
+ println! 打印到 stdout，而 dbg! 打印到 stderr；它还会打印调用所在的文件名和行号。

### 对表达式调用 dbg! 宏后，该表达式的值会怎样？
~ structs/dbg-macro-ownership
A) dbg! 返回该值的所有权，可继续赋给别处
B) 值被丢弃，无法再使用
C) 值被复制一份，原值被移动
D) 返回一个永远为 false 的布尔值
= A
+ dbg! 接收一个表达式的所有权，打印其值后返回该值的所有权，所以可把 dbg!(30 * scale) 直接用于字段初始化。

### 方法签名中的 &self 是什么的缩写？
~ structs/method-self
A) self: &Self
B) self: Self
C) &self: Rectangle
D) self: &mut Self
= A
+ 在 impl 块中 Self 是 impl 类型的别名，&self 是 self: &Self 的缩写，表示不可变地借用实例。

### 如果方法需要修改调用它的结构体实例，第一个参数应该写成？
~ structs/method-mut-self
A) &mut self
B) &self
C) self
D) mut self: Self
= A
+ 要改变调用方法的实例，需要把第一个参数改为 &mut self；&self 只能读取，self 会取得所有权。

### 结构体 Rectangle 上既有字段 width，又有同名方法 width。表达式 `rect1.width` 和 `rect1.width()` 分别指？
~ structs/method-field-same-name
A) 前者是字段，后者是方法
B) 前者是方法，后者是字段
C) 两者都是字段
D) 两者都是方法
= A
+ 加圆括号时 Rust 认为是方法 width，不加圆括号时认为是字段 width。

### 调用定义在 Rectangle 上、不以 self 为参数的关联函数 square，应写成？
~ structs/associated-function
A) Rectangle::square(3)
B) Rectangle.square(3)
C) rect1::square(3)
D) square(&Rectangle, 3)
= A
+ 使用结构体名和 :: 语法调用关联函数，例如 Rectangle::square(3)；关联函数并不作用于某个实例。

### 在 Rust 中调用方法时，关于 C/C++ 里的 -> 运算符，下列说法正确的是？
~ structs/automatic-ref-deref
A) Rust 没有 -> 运算符，用 . 调用并自动进行引用和解引用
B) Rust 用 -> 在指针上调用方法
C) Rust 的 . 只能用于字段，方法必须用 ->
D) 只有 unsafe 代码中才能用 ->
= A
+ Rust 没有与 -> 等效的运算符，方法调用时 Rust 会自动为接收者添加 &、&mut 或 * 以匹配方法签名。

## 枚举和模式匹配

### 定义了 `enum IpAddrKind { V4, V6 }` 之后，在代码中引用 `V4` 成员的正确写法是哪个？
~ 枚举/成员访问语法
A) IpAddrKind.V4
B) V4::IpAddrKind
C) IpAddrKind::V4
D) IpAddrKind->V4
= C
+ 枚举成员位于其标识符的命名空间中，用两个冒号 `::` 分隔，所以是 `IpAddrKind::V4`。

### 已有函数 `fn route(ip_type: IpAddrKind) {}`，下列哪种调用方式是合法的？
~ 枚举/成员同属一个类型
A) 只能用 route(IpAddrKind::V4)
B) route(IpAddrKind::V4) 和 route(IpAddrKind::V6) 都可以
C) 必须写成 route(IpAddrKind) 直接传入枚举名
D) 必须为 V4 和 V6 分别定义互不相同的类型再调用
= B
+ `IpAddrKind::V4` 和 `IpAddrKind::V6` 都是 `IpAddrKind` 类型的值，因此都能作为实参传入。

### 为什么像 `enum IpAddr { V4(u8,u8,u8,u8), V6(String) }` 这样的需求很难用单个结构体表达？
~ 枚举/成员携带不同类型和数量的数据
A) 结构体的字段类型是固定的，无法让不同“种类”各自携带不同类型和数量的数据
B) 结构体不能存储 String
C) 结构体不能作为函数参数
D) 枚举成员不能存储 u8
= A
+ 枚举的每个成员可以关联不同类型和数量的数据，而结构体所有实例的字段集合与类型都是同一套。

### 标准库风格的 `enum IpAddr { V4(Ipv4Addr), V6(Ipv6Addr) }` 说明了枚举成员的什么能力？
~ 枚举/成员可存放结构体等任意类型
A) 枚举成员只能存放基本标量类型
B) 枚举成员只能存放一个 String
C) 枚举成员必须都存放相同的类型
D) 枚举成员可以存放任意类型的数据，包括结构体
= D
+ 枚举成员的关联数据可以是字符串、数字、结构体，甚至另一个枚举。

### 在 `enum Message { Quit, Move { x: i32, y: i32 }, Write(String), ChangeColor(i32,i32,i32) }` 中，`Move` 成员携带的数据相当于什么？
~ 枚举/匿名结构体成员
A) 一个匿名结构体，带具名字段 x 和 y
B) 一个元组结构体 (i32, i32)
C) 一个没有任何字段的类单元结构体
D) 一个返回 i32 的方法
= A
+ `Move { x: i32, y: i32 }` 内嵌的是一个匿名的结构体形式，字段有名字；而 `ChangeColor(i32,i32,i32)` 才是元组结构体形式。

### 关于在枚举上定义方法，下列说法正确的是？
~ 枚举/定义方法
A) 只有结构体可以定义方法，枚举不可以
B) 可以像结构体那样用 impl 为枚举定义方法，方法中用 self 获取调用它的值
C) 枚举的方法只能写成不带 self 的关联函数
D) 枚举的方法必须命名为 call
= B
+ 枚举和结构体一样可以用 `impl` 块定义方法，方法体通过 `self` 获得调用该方法的值。

### 标准库中 `Option<T>` 枚举的定义是？
~ Option/枚举定义
A) enum Option<T> { Some(T), None }
B) enum Option<T> { Some, None(T) }
C) enum Option<T> { Ok(T), Err }
D) enum Option<T> { Value(T), Null }
= A
+ `Option<T>` 定义为两个成员：`Some(T)` 携带一个 T 值，`None` 不携带数据。

### 关于 `Some` 和 `None` 的使用，下列说法正确的是？
~ Option/prelude 与成员前缀
A) 必须写 Option::Some 和 Option::None 才能编译
B) Some 和 None 是语言关键字，不是枚举成员
C) Option 及其成员在 prelude 中，可以直接写 Some 和 None 而不需要 Option:: 前缀
D) 只有 None 可以省略前缀，Some 不行
= C
+ `Option<T>` 被包含在 prelude 中，其成员也可以不加 `Option::` 前缀直接使用，但它们仍是 `Option<T>` 的成员。

### 为什么通常要写成 `let absent_number: Option<i32> = None;`？
~ Option/None 需要类型标注
A) 编译器只通过 None 无法推断出 Some 成员要保存的类型
B) None 并不是 Option 的成员
C) None 只能用于 String 类型
D) 因为 None 是关键字，凡使用都必须标注类型
= A
+ `None` 本身不含类型信息，编译器无法推断 `Option<T>` 中的 T，因此需要显式标注。

### 执行 `let x: i8 = 5; let y: Option<i8> = Some(5); let sum = x + y;` 会发生什么？
~ Option/与 T 是不同的类型
A) 编译通过，sum 为 10
B) 编译通过，sum 为 Some(10)
C) 编译错误，因为 Option<i8> 与 i8 是不同的类型，不能直接相加
D) 编译通过，运行时 panic
= C
+ `Option<i8>` 和 `i8` 是不同类型，标准库没有为 `i8 + Option<i8>` 实现加法，因此编译失败。

### `match` 关键字后面跟的那个表达式，与 `if` 的条件表达式相比，类型要求有何不同？
~ match/匹配表达式的类型要求
A) 可以是任意类型，不像 if 那样必须返回布尔值
B) 同样必须是布尔值
C) 必须是整数类型
D) 必须是枚举类型
= A
+ `if` 的条件必须是布尔值，而 `match` 匹配的表达式可以是任何类型，例子中就是 `Coin` 枚举。

### `match` 表达式执行时，如何决定走哪个分支？
~ match/按顺序匹配首个符合的分支
A) 执行所有模式匹配的分支
B) 按顺序将值与各分支模式比较，执行第一个匹配到的分支
C) 在所有匹配的分支中随机选一个
D) 优先执行代码最短的分支
= B
+ `match` 把值按顺序与每个分支的模式比较，遇到第一个匹配的分支就执行它，后续分支不再比较。

### 关于 `match` 每个分支中 `=>` 后面的代码，下列说法正确的是？
~ match/分支代码是表达式
A) 它必须是语句，不能产生值
B) 它必须是函数调用
C) 它只能是字面量
D) 它是一个表达式，其结果值作为整个 match 表达式的返回值
= D
+ 每个分支关联的代码是一个表达式，该表达式的值就是整个 `match` 表达式的值。

### 调用 `value_in_cents(Coin::Quarter(UsState::Alaska))` 时，分支模式 `Coin::Quarter(state)` 中的 `state` 会绑定到什么？
~ match/绑定值的模式
A) Coin::Quarter
B) 整个 Coin 值
C) UsState::Alaska
D) None
= C
+ 模式匹配成功时，`state` 绑定到 `Quarter` 成员内部携带的那个州的值，即 `UsState::Alaska`。

### `plus_one` 函数只写了 `Some(i) => Some(i + 1)` 这一个分支而没有处理 `None`，结果会怎样？
~ match/穷尽性
A) 编译错误，match 必须穷举所有可能，编译器会指出遗漏了 None
B) 编译通过，传入 None 时原样返回 None
C) 编译通过，传入 None 时 panic
D) 编译通过，但传入 None 时行为未定义
= A
+ Rust 中的匹配是穷举式的，必须覆盖所有可能性；遗漏 `None` 分支会编译失败，编译器还会指出漏掉了哪个模式。

### 骰子游戏里用变量 `other` 作为兜底分支，为什么它必须放在最后？
~ match/通配分支必须放最后
A) 模式按顺序匹配，把它放在前面会使后面的分支永远匹配不到，Rust 会给出警告
B) 因为 other 是保留关键字
C) 因为编译器要求兜底分支必须命名为下划线
D) 因为 other 只能匹配数值 3 和 7
= A
+ `other` 能匹配任意值，若放在前面则后续分支永远不会被匹配，Rust 会警告这些分支不可达。

### 把兜底模式由变量 `other` 改成 `_`，主要区别是什么？
~ match/下划线不绑定值
A) `_` 只能匹配 0
B) `_` 匹配任意值但不绑定它，所以不会警告存在未使用的变量
C) `_` 同样会绑定值并允许在分支代码中使用
D) `_` 会关闭 match 的穷尽性检查
= B
+ `_` 是特殊的通配模式，匹配任意值而不绑定，因此不会产生“未使用变量”的警告，同时仍满足穷尽性要求。

### 如果掷出 3 或 7 以外的值时你的回合什么都不做，那么 `_` 分支的代码应该写成什么？
~ match/单元值分支
A) `()`
B) `None`
C) `break`
D) 直接省略不写
= A
+ 使用单元值 `()` 作为分支代码，表示不运行任何操作，同时明确忽略了未匹配的值。

### 关于 `if let`，下列说法正确的是？
~ if let/与 match 的关系
A) 它是 match 的语法糖，只匹配一个模式而忽略其他，但会失去穷尽性检查
B) 它比 match 更严格，强制穷举所有情况
C) 它不能绑定模式中的值
D) 它只能用于 Option 类型
= A
+ `if let` 可以看作只关心一个分支的 `match` 简写，代码更简洁，但放弃了 `match` 强制的穷尽性检查。

### `if let Coin::Quarter(state) = coin { ... } else { count += 1; }` 中的 `else` 块，相当于等价 match 表达式的哪个部分？
~ if let/else 与 match 的兜底分支
A) `Coin::Quarter(state)` 这个模式
B) 整个 match 表达式的返回值
C) `if let` 的模式部分
D) `_ => count += 1` 这个兜底分支
= D
+ `if let` 的 `else` 块对应 match 中 `_` 分支的代码，两者行为等价。

## 使用包、Crate 和模块管理不断增长的项目

### 关于 crate 根（crate root），下列哪项描述是正确的？
~ 包与crate/crate根定义
A) crate 根是一个源文件，Rust 编译器以它为起始点，并构成 crate 的根模块
B) crate 根是存放 Cargo.toml 的包目录
C) crate 根是一个包中所有 crate 的统称
D) crate 根是 src/bin 目录，编译器从那里开始构建
= A
+ crate root 是一个源文件，编译器以它为起始点并构成 crate 的根模块。

### 一个包中至多可以包含多少个库 crate（library crate）？
~ 包与crate/包中库crate的数量
A) 至多一个
B) 任意多个
C) 至少两个
D) 数量必须与二进制 crate 相同
= A
+ 一个包中至多只能包含一个库 crate，但可以包含任意多个二进制 crate。

### 如果一个包同时含有 src/main.rs 和 src/lib.rs，那么这个包包含什么？
~ 包与crate/同时含main与lib的包
A) 两个 crate：一个库和一个二进制项，且名字都与包相同
B) 只有一个二进制 crate，src/lib.rs 会被忽略
C) 只有一个库 crate，src/main.rs 会被当作库的一部分
D) 编译器报错，因为一个包只能有一个 crate 根
= A
+ src/main.rs 与 src/lib.rs 分别是对应同名二进制 crate 与库 crate 的 crate 根，因此这样的包有两个 crate。

### 一个包怎样才能拥有多个二进制 crate？
~ 包与crate/src-bin目录下的多个二进制crate
A) 把文件放在 src/bin 目录下，每个文件都会被编译成一个独立的二进制 crate
B) 在 src 下创建多个 lib.rs 文件
C) 每个二进制 crate 都必须有自己的 Cargo.toml
D) 为每个二进制 crate 单独运行一次 cargo new
= A
+ src/bin 下的每个文件都会被编译成一个独立的二进制 crate。

### 我们的 crate 中定义了一个 struct Rng，同时依赖的 rand crate 提供了一个名为 Rng 的 trait。编译器为什么不会混淆这两个名字？
~ crate/作用域与命名冲突
A) 因为 crate 的功能在自身作用域内命名，我们的 Rng 指向自定义 struct，rand 的 trait 要通过 rand::Rng 访问
B) 因为 Cargo 会自动为同名项加上别名
C) 因为 trait 与 struct 处于不同的命名空间，所以同名也不会冲突
D) 因为 rand 的 Rng 在使用前必须先在本 crate 中重新定义一次
= A
+ 每个 crate 的功能在自己的作用域内命名，所以本地的 Rng 与 rand::Rng 互不干扰。

### 整个模块树的根位于哪里？
~ 模块/模块树的根
A) 位于名为 crate 的隐式模块下
B) 位于 src/main.rs 或 src/lib.rs 文件名之下
C) 位于包名对应的显式模块下
D) 位于 front_of_house 这样的最外层显式模块下
= A
+ src/main.rs 或 src/lib.rs 的内容构成名为 crate 的模块，它位于模块树的根部。

### 绝对路径以什么开头？
~ 路径/绝对路径
A) crate 名或者字面量 crate
B) self、super 或当前模块的标识符
C) 双冒号 ::
D) 包名
= A
+ 绝对路径从 crate 根部开始，以 crate 名或字面量 crate 开头。

### 相对路径以什么开头？
~ 路径/相对路径
A) self、super 或当前模块的标识符
B) crate 或 crate 名
C) 只能是 super
D) 双冒号 ::
= A
+ 相对路径从当前模块开始，以 self、super 或当前模块的标识符开头。

### 在 Rust 中，默认情况下项的私有性如何？
~ 私有性/默认私有
A) 所有项（函数、方法、结构体、枚举、模块和常量）都是私有的
B) 只有函数是私有的，模块默认公有
C) 只有模块是私有的，函数默认公有
D) 项默认是公有的，需要显式写 priv 才私有
= A
+ Rust 中默认所有项都是私有的，可用 pub 显式公开。

### 关于父模块与子模块之间的私有性，下列哪项正确？
~ 私有性/父子模块的可见方向
A) 父模块中的项不能使用子模块中的私有项，但子模块中的项可以使用其父模块中的项
B) 父模块可以访问子模块的私有项，反之不行
C) 父子模块互相都可以访问对方的私有项
D) 父子模块互相都不能访问对方的私有项
= A
+ 子模块封装隐藏实现细节，但能看到自己定义所在的上下文，因此可访问父模块的项；反之不行。

### 在 `mod hosting` 前加上 `pub` 后，会产生什么效果？
~ pub/在模块上的效果
A) 使模块可被其父模块引用，但模块里的内容仍然是私有的
B) 使模块及其内部所有项都变为公有
C) 使模块对它所在 crate 之外的代码也完全公开，包括内部所有函数
D) 没有任何效果，pub 只对函数和结构体有效
= A
+ 模块上的 pub 只允许父模块引用该模块，模块的内容仍需各自用 pub 公开。

### 给结构体定义加上 `pub` 之后，它的字段是什么状态？
~ pub/公有结构体的字段
A) 字段仍然是私有的，需要有选择地给每个字段加 pub
B) 所有字段都随之变为公有
C) 所有字段仍然是私有的，且无法单独公开
D) 字段只有在结构体派生了 Debug 之后才可访问
= A
+ 公有结构体的字段默认仍私有，可以逐个字段用 pub 公开。

### 把枚举设为公有之后，它的成员（变体）是什么状态？
~ pub/公有枚举的成员
A) 所有成员都变为公有
B) 成员仍然是私有的，需要逐个加 pub
C) 只有第一个成员是公有的
D) 成员的可访问性取决于枚举是否是 pub 的父模块
= A
+ 枚举一旦公有，其所有变体都公有，因为逐个加 pub 会很繁琐且枚举成员私有几乎无意义。

### 按照惯用法，用 `use` 引入函数与引入结构体（如 HashMap）分别应怎么写？
~ use/惯用的use路径
A) 函数应引入其父模块，调用时写 hosting::add_to_waitlist；结构体和枚举应引入完整路径
B) 函数应引入完整路径直到函数名；结构体应只引入其父模块
C) 两者都必须引入完整路径直到项名
D) 两者都只应引入所在 crate 的名字
= A
+ 引入函数的父模块能表明函数不是本地定义的；引入结构体/枚举则约定用完整路径。

### 当需要把两个同名类型（如 std::fmt::Result 和 std::io::Result）引入同一作用域时，用 `as` 怎么写才正确？
~ use/as关键字重命名
A) use std::fmt::Result; 与 use std::io::Result as IoResult;
B) use std::fmt::Result as Result; 与 use std::io::Result;
C) use std::fmt as Result; 与 use std::io::Result;
D) use std::fmt::Result, std::io::Result as IoResult;
= A
+ 用 as 给其中一个类型指定本地新名称即可避免同名冲突。

### `pub use` 的作用是什么？
~ use/pub-use重导出
A) 将名称引入当前作用域，同时使其可供外部代码引入自己的作用域（重导出）
B) 只把 use 语句本身变为可被外部代码看到的注释
C) 让被引入的项变为该 crate 私有
D) 把外部包的源码复制进当前 crate
= A
+ pub use 把项引入作用域的同时使其可被外部代码通过新路径使用，即重导出。

### 要在项目中使用 crates.io 上的外部包 rand，需要做哪些事？
~ 外部包/使用外部包的步骤
A) 在 Cargo.toml 的 [dependencies] 中列出 rand，并用 use 将其中定义的项引入作用域
B) 把 rand 的源码文件复制到 src 目录下
C) 只需在代码中写 extern crate rand，无需修改 Cargo.toml
D) 必须先把 rand 发布到自己的账号下才能使用
= A
+ 在 Cargo.toml 声明依赖让 Cargo 下载，再通过 use 把项引入作用域。

### `use std::io::{self, Write};` 这一行将什么引入了作用域？
~ use/嵌套路径中的self
A) 同时引入 std::io 和 std::io::Write
B) 只引入 std::io::self 这个项
C) 只引入 std::io::Write，self 是多余的语法错误
D) 等价于 use std::io::*;
= A
+ 嵌套路径中的 self 表示路径前缀本身，因此 std::io 和 std::io::Write 都被引入。

### `use std::collections::*;` 的作用是什么？
~ use/glob运算符
A) 将 std::collections 中定义的所有公有项引入当前作用域
B) 将 std::collections 中包括私有项在内的所有项引入当前作用域
C) 只引入当前尚未使用的公有项
D) 只在 tests 模块中有效，其他位置会编译错误
= A
+ glob 运算符将路径下所有公有项引入作用域，应谨慎使用以免难以判断名称来源。

### 把 front_of_house 模块放到 src/front_of_house.rs 后，再想把其中的 hosting 子模块提取到自己的文件，应当创建哪个文件？
~ 模块/拆分到文件时的文件路径
A) src/front_of_house/hosting.rs，并在 src/front_of_house.rs 中写 `pub mod hosting;`
B) src/hosting.rs，并在 src/lib.rs 中写 `pub mod hosting;`
C) src/bin/hosting.rs，并在 src/lib.rs 中写 `mod hosting { }`
D) src/front_of_house/hosting/mod.rs 必须放在 crate 根目录下
= A
+ 子模块文件放在与父模块同名的目录下；`mod hosting;` 用分号声明，告诉 Rust 在另一个同名文件中加载模块内容。

## 常见集合

### 当编写 `let v = Vec::new();` 而没有向 `v` 中插入任何值时，Rust 编译器通常会要求添加类型标注，原因是？
~ vec/creation-empty-type-annotation
A) 编译器无法从空 vector 推断出元素类型
B) `Vec::new` 只能创建 `Vec<i32>`，所以需要标注为 `i32`
C) 类型标注是为了告诉编译器 vector 的长度
D) 因为 `Vec` 不是泛型类型，必须指定具体类型
= A
+ 空 vector 没有元素可供推断类型，因此需要标注元素类型。`Vec::new` 可创建任意类型；长度由元素个数决定，不是类型标注；`Vec` 是泛型。

### 为了使用 `push` 方法向一个 vector 添加元素，变量绑定必须满足什么条件？
~ vec/update-mutability
A) 必须声明为 `mut` 可变
B) 必须使用 `const` 声明
C) 必须是 `String` 类型
D) 必须使用 `let` 而不是 `let mut`
= A
+ `push` 修改 vector，因此需要可变绑定。`const` 声明的值不可变；类型与能否 push 无关。

### 对于 `let v = vec![1, 2, 3];`，执行 `let x = &v[5];` 会发生什么？
~ vec/access-index-panic
A) 编译错误，因为索引越界
B) 运行时 panic，因为索引越界
C) 返回 `None`
D) 返回 0
= B
+ 索引语法在运行时检查，越界会 panic。返回 `None` 是 `get` 方法的行为。

### 对 vector 调用 `get` 方法并传入一个可能越界的索引时，它的返回值是什么类型？
~ vec/access-get-option
A) `Option<&T>`
B) `&T`
C) `T`
D) `Result<&T, Error>`
= A
+ `get` 返回 `Option<&T>`，越界时返回 `None`。索引语法返回 `&T` 但越界会 panic。

### 为什么下面的代码不能编译通过？`let mut v = vec![1, 2, 3]; let first = &v[0]; v.push(4); println!("{}", first);`
~ vec/borrow-check-push
A) 因为 `push` 需要可变借用，而 `first` 仍持有不可变借用
B) 因为 `v` 没有声明为 `mut`
C) 因为 `push` 只能添加与 `first` 相同类型的值
D) 因为 `println!` 不能打印引用
= A
+ 借用规则禁止同时存在可变和不可变引用；`push` 可能重新分配内存，使 `first` 悬垂。

### 在 `for i in &mut v { *i += 50; }` 中，为什么需要使用解引用运算符 `*`？
~ vec/iterate-mutable-deref
A) `i` 是 `&mut i32`，必须解引用才能修改其指向的值
B) `i` 是 `i32`，`*` 用于乘法
C) `i` 是 `&i32`，不可变引用不能修改
D) `*` 用于获取 vector 的长度
= A
+ 遍历可变引用得到 `&mut i32`，需解引用赋值。`*` 在此不是乘法。

### 要在同一个 vector 中储存整数、浮点数和字符串，推荐使用什么方式？
~ vec/enum-multiple-types
A) 定义一个枚举，其成员分别包装这些类型，然后创建储存该枚举值的 vector
B) 使用 `Vec<Box<dyn Any>>`，因为这是唯一方法
C) 直接使用 `Vec<&str>` 并转换所有类型为字符串
D) 使用多个不同类型的 vector 并分别索引
= A
+ 枚举的成员属于同一枚举类型，因此 vector 元素类型一致。使用 `Any` 会丢失类型信息，且不是本节推荐方式。

### 关于 Rust 中的字符串类型，下列说法正确的是？
~ string/types-str-vs-string
A) `str` 是核心语言中的字符串 slice 类型，通常以 `&str` 形式使用；`String` 是标准库提供的可增长、可变、有所有权的 UTF-8 字符串
B) `String` 是核心语言内置类型，而 `str` 来自标准库
C) `str` 和 `String` 都是可增长的
D) `&str` 拥有其指向的字符串数据的所有权
= A
+ 核心语言只有 `str`；`String` 是标准库提供的。`&str` 是借用而非拥有。

### `push_str` 方法接收什么类型的参数，为什么调用后原字符串切片仍然可用？
~ string/push_str-borrow
A) 接收 `&str`，因为它不获取参数的所有权
B) 接收 `String`，因为它会移动参数
C) 接收 `char`，因为它追加单个字符
D) 接收 `Vec<u8>`，因为它复制字节
= A
+ `push_str` 接收字符串 slice，不获取所有权，所以原值仍可用。接收 `char` 的是 `push`。

### 执行 `let s3 = s1 + &s2;` 后，关于 `s1` 和 `s2` 的有效性，正确的是？
~ string/concat-plus-move
A) `s1` 被移动，不能再使用；`s2` 仍然有效
B) `s1` 和 `s2` 都仍然有效
C) `s1` 仍然有效；`s2` 被移动
D) `s1` 和 `s2` 都被移动
= A
+ `+` 调用 `add`，获取 `self` 所有权（`s1` 移动），第二个参数是 `&str`，所以 `s2` 仍有效。

### 在 Rust 中，`let s = String::from("hello"); let h = s[0];` 不能编译，主要原因是？
~ string/index-not-allowed
A) `String` 没有实现按整数索引的 `Index` trait，因为 UTF-8 字符长度可变且索引返回值不明确
B) `String` 只能使用 `get` 方法，但 `get` 返回的是字符
C) `s[0]` 语法只适用于数组，不适用于任何字符串
D) 字符串索引总是返回字节，但 Rust 禁止返回字节
= A
+ 字符串不支持整数索引，因为字节、标量值、字形簇的歧义以及 O(1) 保证。`get` 不是索引语法。

### 对于 `let len = String::from("Здравствуйте").len();`，`len` 的值是多少？
~ string/byte-length
A) 24，因为 `len()` 返回字节数，而该字符串的 UTF-8 编码占 24 字节
B) 12，因为字符串有 12 个字符
C) 6，因为每个字符占 2 字节
D) 4，因为 `len` 只统计不同字符
= A
+ `len()` 返回字节长度；该俄语字符串每个字符 2 字节，共 12 字符，即 24 字节。

### 对于 `let hello = "Здравствуйте"; let s = &hello[0..1];`，运行时会发生什么？
~ string/slice-range-panic
A) panic，因为字节索引 1 不在字符边界上
B) 返回字符串 `"З"`
C) 返回字符串 `"Зд"`
D) 编译错误，因为不能对字符串使用范围索引
= A
+ 范围 slice 必须落在字符边界上；`0..1` 截断多字节字符，运行时 panic。`0..2` 才会得到 `"З"`。

### 要遍历字符串中的 Unicode 标量值（即 `char`），应使用哪个方法？
~ string/iterate-chars-bytes
A) `chars()`
B) `bytes()`
C) `as_bytes()`
D) `graphemes()`
= A
+ `chars()` 返回 `char` 的迭代器；`bytes()` 返回原始字节；`graphemes()` 不是标准库方法。

### 为什么使用 `HashMap` 时通常需要写 `use std::collections::HashMap;`？
~ hashmap/import-prelude
A) `HashMap` 没有被包含在预导入（prelude）中
B) `HashMap` 是核心语言的一部分，但需要显式导入
C) `use` 语句是为了给 `HashMap` 起别名
D) `HashMap` 只能通过 `use` 才能创建实例
= A
+ `HashMap` 不在 prelude 中，需显式导入。它是标准库集合类型，不是核心语言内置。

### 当使用 `map.insert(field_name, field_value);` 将两个 `String` 插入 `HashMap` 后，`field_name` 和 `field_value` 会怎样？
~ hashmap/ownership-move
A) 它们被移动到哈希 map 中，之后不能再使用这两个绑定
B) 它们被复制，原绑定仍然可用
C) 它们被借用，原绑定仍然可用但不可变
D) 它们被克隆，原绑定和 map 各有一份
= A
+ 对于拥有所有权的 `String`，`insert` 会移动值，map 成为所有者。

### 对 `HashMap` 调用 `get` 方法时，如果键存在，返回什么？
~ hashmap/get-option
A) `Some(&V)`，其中 `V` 是值的类型
B) `&V`
C) `V`
D) `Some(V)`
= A
+ `get` 返回 `Option<&V>`，存在时返回 `Some(&value)`。

### 如果对同一个键连续调用两次 `insert`，会发生什么？
~ hashmap/insert-overwrite
A) 新值覆盖旧值，map 中只保留一个键值对
B) 两个值都会被保留，形成一个列表
C) 第二次 `insert` 会导致 panic
D) 第二次 `insert` 被忽略，保留旧值
= A
+ `insert` 会替换旧值。忽略新值并保留旧值是 `entry(...).or_insert(...)` 的行为。

### `scores.entry(String::from("Blue")).or_insert(50);` 的作用是什么？
~ hashmap/entry-or_insert
A) 如果键 "Blue" 不存在，则插入值 50；如果存在，则返回其值的可变引用
B) 总是将值覆盖为 50
C) 如果键 "Blue" 不存在，则返回 `None`
D) 删除键 "Blue" 并插入 50
= A
+ `entry` 返回 `Entry`，`or_insert` 在不存在时插入并返回新值可变引用，存在时返回现有值可变引用。

### 在示例 `let count = map.entry(word).or_insert(0); *count += 1;` 中，为什么需要 `*count`？
~ hashmap/update-old-value
A) `count` 是 `&mut V`，必须解引用才能修改其指向的值
B) `count` 是 `V`，`*` 用于乘法
C) `count` 是 `&V`，不可变引用不能修改
D) `*` 用于从哈希 map 中删除元素
= A
+ `or_insert` 返回可变引用 `&mut V`，需解引用赋值。

## 错误处理

### 当程序中执行 `panic!` 宏时，默认情况下 Rust 会怎么做？
~ 错误处理/panic! 的默认行为
A) 立即终止程序，不清理任何栈数据
B) 打印错误信息，展开并清理栈上遇到的每个函数的数据，然后退出
C) 忽略错误并继续执行后续代码
D) 将错误转换为 `Result::Err` 返回给调用者
= B
+ 书中开头说明：执行 `panic!` 时程序会打印错误信息，展开（unwind）并清理栈数据，然后退出。

### 如果希望 panic 时直接终止程序而不展开清理栈数据，应在 Cargo.toml 中如何配置？
~ 错误处理/panic 时终止而非展开
A) 在 `[profile.release]` 部分增加 `panic = 'abort'`
B) 在 `[dependencies]` 部分增加 `panic = 'abort'`
C) 在源码中调用 `std::process::abort()`
D) 设置环境变量 `RUST_PANIC=abort`
= A
+ 书中给出在 Cargo.toml 的 `[profile]` 部分（如 `[profile.release]`）增加 `panic = 'abort'` 即可由展开切换为终止。

### panic 输出中的 `src/main.rs:2:5` 这样的位置信息表示什么？
~ 错误处理/panic 消息定位
A) 文件第二行第五个字符，即 panic 出现的位置
B) 文件第二列第五行，即 panic 出现的位置
C) 文件名 main.rs 中的第 2 个字符
D) 一个与问题无关的随机行号与列号
= A
+ 书中说明 `src/main.rs:2:5` 表明这是 src/main.rs 文件的第二行第五个字符，即 panic 出现的位置。

### 阅读 Rust 的 backtrace 以定位代码中出问题的地方，正确的阅读方式是什么？
~ 错误处理/backtrace 阅读方式
A) 从末尾开始读，最后一行就是问题的发源地
B) 从头开始读，直到发现你编写的文件，那一行就是问题的发源地
C) 只需读中间一半的内容
D) 只看第一行即可
= B
+ 书中指出阅读 backtrace 的关键是从头开始读直到发现你编写的文件，那一行就是问题的发源地。

### 要获取 panic 时带有信息的 backtrace，应该怎么做？
~ 错误处理/获取 backtrace
A) 将环境变量 `RUST_BACKTRACE` 设置为任何不是 0 的值
B) 在 Cargo.toml 中设置 `backtrace = true`
C) 在代码中调用 `std::backtrace::print()` 函数
D) 只能使用 release 模式构建才能得到
= A
+ 书中通过 `RUST_BACKTRACE=1 cargo run` 示例说明：把 `RUST_BACKTRACE` 环境变量设为任何不是 0 的值即可获得 backtrace。

### 在示例中尝试用 `v[99]` 访问只包含 3 个元素的 vector 会发生什么？
~ 错误处理/越界访问 panic
A) 返回对应内存位置的值，类似 C 语言的行为
B) Rust 会 panic，停止执行并拒绝继续，以避免不安全的内存访问
C) 返回一个默认值 0
D) 在编译期直接报错，无法构建
= B
+ 书中说明如果尝试读取一个索引不存在的元素，Rust 会停止执行并拒绝继续，以避免像 C 那样缓冲区溢出带来的安全问题。

### 标准库的 `Result<T, E>` 枚举有哪两个成员？
~ 错误处理/Result 枚举定义
A) `Some(T)` 和 `None`
B) `Ok(T)` 和 `Err(E)`
C) `Ok(E)` 和 `Err(T)`
D) `True` 和 `False`
= B
+ 书中给出 `enum Result<T, E> { Ok(T), Err(E) }`，`T` 是成功时 Ok 中的数据，`E` 是失败时 Err 中的错误。

### 根据书中的例子，`File::open` 的返回值类型是什么？
~ 错误处理/File::open 返回值类型
A) `u32`
B) `Result<std::fs::File, std::io::Error>`
C) `Option<std::fs::File>`
D) `std::fs::File`
= B
+ 书中通过类型不匹配的编译错误说明 `File::open` 返回 `Result<std::fs::File, std::io::Error>`，成功时是文件句柄，失败时是 io::Error。

### 在 `match` 分支中直接写 `Ok(file)` 和 `Err(error)` 而不写成 `Result::Ok`、`Result::Err`，原因是什么？
~ 错误处理/Result 变体在 prelude
A) `Result` 枚举和其成员已被导入到了 prelude 中
B) `Ok` 和 `Err` 是语言关键字
C) 必须写 `use std::result::Result::*;` 才能编译
D) 编译器会根据上下文自动补全路径，其实写错了
= A
+ 书中指出与 `Option` 一样，`Result` 枚举和其成员也被导入到了 prelude 中，所以不需要在 match 分支中指定 `Result::`。

### 示例中要区分「文件不存在」与其他打开文件的错误，是通过什么方式判断的？
~ 错误处理/匹配不同错误类型
A) 比较错误信息字符串是否等于某个固定文本
B) 调用 `error.kind()` 并与 `ErrorKind::NotFound` 进行匹配
C) 检查错误码是否等于 404
D) 调用 `error.is_not_found()` 方法
= B
+ 书中示例 9-5 通过 `match error.kind()` 匹配 `ErrorKind::NotFound` 来判断文件是否不存在，其他错误用 `other_error` 分支处理。

### 对于 `Result<T, E>`，`unwrap` 方法的行为是什么？
~ 错误处理/unwrap 的语义
A) 如果是 `Ok` 返回其中的值，如果是 `Err` 则调用 `panic!`
B) 总是返回 `Err` 中的错误值
C) 如果是 `Err` 返回一个默认值
D) 无论 `Ok` 还是 `Err` 都直接调用 `panic!`
= A
+ 书中说明 `unwrap` 在 `Ok` 时返回其中的值，在 `Err` 时会调用 `panic!`。

### `expect` 与 `unwrap` 的主要区别是什么？
~ 错误处理/expect 与 unwrap 的区别
A) `expect` 在 `Ok` 时返回的值与 `unwrap` 不同
B) `expect` 在 panic 时使用调用者提供的错误信息，而 `unwrap` 使用默认信息
C) `expect` 遇到 `Err` 时不会 panic
D) `expect` 只能用于 `Option` 而不能用于 `Result`
= B
+ 书中说明 `expect` 与 `unwrap` 使用方式一样，但 `expect` 调用 `panic!` 时使用我们传给它的参数作为错误信息，而 `unwrap` 使用默认信息。

### 在 `File::open("hello.txt").unwrap_or_else(|error| { ... })` 中，闭包参数 `error` 代表什么？
~ 错误处理/unwrap_or_else
A) 成功时得到的文件句柄
B) 失败时 `Result` 中的 `Err` 值
C) 一个固定的字符串消息
D) 被打开的文件名
= B
+ `unwrap_or_else` 在结果为 `Err` 时调用闭包并把错误值传给它，因此 `error` 是 `Err` 中的值，可用来判断错误种类并决定如何处理。

### 在 Rust 中「传播（propagating）错误」指的是什么？
~ 错误处理/传播错误
A) 在函数内部直接调用 `panic!` 终止程序
B) 将错误返回给调用者，让调用者决定如何处理
C) 忽略错误并继续执行后续代码
D) 把错误打印到标准输出后继续执行
= B
+ 书中说明传播错误是指把错误返回给调用者，让调用者根据其拥有的更多信息或逻辑决定如何处理。

### 当 `?` 运算符用于一个 `Result` 值时，它的行为是什么？
~ 错误处理/? 运算符行为
A) 如果是 `Ok`，返回其中的值并继续执行；如果是 `Err`，将错误作为整个函数的返回值提前返回
B) 无论 `Ok` 还是 `Err` 都调用 `panic!`
C) 只对 `Ok` 有效，对 `Err` 会 panic
D) 把 `Ok` 和 `Err` 都转换成字符串
= A
+ 书中说明 `?` 与示例 9-6 的 `match` 有完全相同的工作方式：`Ok` 时取出值继续，`Err` 时像使用了 `return` 一样把错误返回给调用者。

### `?` 运算符在处理 `Err` 时比手写 `match` 多做了一件事：它把错误值传给了什么？
~ 错误处理/? 的 From 转换
A) `panic!` 宏
B) 标准库 `From` trait 的 `from` 函数，用于把错误转换为当前函数返回类型所指定的错误类型
C) `Display` trait 的 `fmt` 方法
D) `Clone` trait 的 `clone` 方法
= B
+ 书中指出 `?` 把错误值传给定义于 `From` trait 的 `from` 函数，将错误从一种类型转换为函数返回类型所指定的错误类型。

### 当 `main` 函数的返回值类型是 `()` 时，在 `main` 中直接对 `File::open` 的返回值使用 `?` 会怎样？
~ 错误处理/? 在 main 中使用
A) 正常编译并运行
B) 编译错误，因为 `?` 只能用于返回 `Result`（或实现了 `Try` 的类型）的函数
C) 编译通过但在运行时 panic
D) 编译通过并自动忽略错误
= B
+ 书中示例给出编译错误，指出 `?` 只能用于返回 `Result` 或其它实现了 `std::ops::Try` 的类型的函数，而 `()` 没有实现。

### 为了让 `main` 中可以使用 `?`，书中给出了哪种 `main` 的可行返回值类型？
~ 错误处理/main 返回 Result
A) `fn main() -> Result<(), Box<dyn Error>>`
B) `fn main() -> io::Error`
C) `fn main() -> String`
D) `fn main() -> bool`
= A
+ 书中说明 `main` 可以返回 `()`，出于方便也可以返回 `Result<T, E>`，示例使用 `fn main() -> Result<(), Box<dyn Error>>`。

### 根据书中的指导，定义可能会失败的函数时，默认的好选择是什么？
~ 错误处理/panic 与 Result 的选择
A) 总是调用 `panic!` 终止程序
B) 返回 `Result`，把如何处理错误的选择权交给调用者
C) 忽略错误继续执行
D) 用 `unwrap` 隐藏错误让调用者看不到
= B
+ 书中指出返回 `Result` 是定义可能会失败的函数的一个好的默认选择，因为它将选择权交给调用者，而不是代替他们决定错误不可恢复。

### 示例 9-10 中的 `Guess` 类型为什么要把 `value` 字段设为私有，并提供 `new` 和 `value` 方法？
~ 错误处理/自定义类型验证
A) 为了减小结构体的内存占用
B) 强制调用者只能通过 `Guess::new` 创建实例，从而保证值始终在 1 到 100 之间
C) 为了让结构体能够派生 `Debug`
D) 为了让外部代码能直接修改 `value` 字段
= B
+ 书中说明私有的 `value` 字段使外部代码不能直接设置它，必须通过 `Guess::new` 创建，从而确保不存在未经范围检查的 `Guess`；`value` 方法作为 getter 读取数据。

## 泛型、trait 与生命周期

### 为消除重复而定义泛型版本的 largest 函数时，类型参数 T 应该声明在哪里？
~ 泛型/函数类型参数声明位置
A) 函数名与参数列表之间的尖括号中，如 fn largest<T>(list: &[T]) -> T
B) 参数列表之后的尖括号中，如 fn largest(list: &[T]) -> T<T>
C) 函数体开头的 let 语句中
D) 返回值类型后面的尖括号中
= A
+ 类型参数声明位于函数名称与参数列表中间的尖括号 <> 中，且必须在使用之前声明。

### 已知 struct Point<T> { x: T, y: T }，执行 let p = Point { x: 5, y: 4.0 }; 会怎样？
~ 泛型/结构体单类型参数约束
A) 编译错误，因为 x 和 y 必须是同一个类型 T
B) 编译通过，T 被推断为能同时容纳整型和浮点型的类型
C) 编译通过，x 为 i32，y 为 f64
D) 编译错误，因为 Point 需要两个泛型参数
= A
+ 只用一个泛型参数的 Point<T> 要求 x 和 y 都是相同类型 T；x 为整型后 T 被确定为整型，y 为 4.0 就类型不匹配。

### 为 Point<T> 实现方法时，impl 头部应该怎么写？
~ 泛型/impl 块泛型声明
A) impl<T> Point<T> { ... }，在 impl 后声明 T 让 Rust 知道尖括号里是泛型
B) impl Point<T> { ... }，无需声明 T
C) impl Point { ... }，泛型参数只写在结构体定义中
D) impl<T> Point { ... }，Point 后不能再写 <T>
= A
+ 必须在 impl 后面声明 T，这样就能在 Point<T> 上实现的方法中使用它，并让 Rust 知道尖括号中的类型是泛型而非具体类型。

### 对 struct Point<T> { x: T, y: T } 写 impl Point<f32> { fn distance_from_origin(&self) -> f32 { ... } }，这意味着什么？
~ 泛型/具体类型 impl 块
A) 只有 T 为 f32 的 Point 实例才有 distance_from_origin 方法
B) 所有 Point<T> 实例都有该方法，但只有 f32 实例能调用
C) 所有 Point<T> 实例都获得该方法，返回类型都是 f32
D) 编译错误，impl 后面必须声明泛型参数
= A
+ 没有在 impl 之后声明泛型而使用具体类型 f32，意味着该方法只定义在 Point<f32> 上，其他 T 的 Point<T> 实例没有此方法。

### 在 impl<T, U> Point<T, U> 中定义 fn mixup<V, W>(self, other: Point<V, W>) -> Point<T, W>，为什么 V 和 W 声明在 fn mixup 之后而不是 impl 之后？
~ 泛型/方法自身泛型参数声明位置
A) 因为它们只相对于方法本身，而 T、U 与结构体定义相对应
B) 因为 V 和 W 是结构体字段的类型
C) 因为 Rust 要求所有泛型参数都必须写在 fn 之后
D) 因为 mixup 是没有 self 的关联函数
= A
+ T 和 U 声明于 impl 之后是因为它们与结构体定义对应；V 和 W 只与方法本身相关，因此声明在 fn mixup 之后。

### Rust 泛型代码在运行时相比具体类型代码没有速度损失，原因是什么？
~ 泛型/单态化
A) 编译器进行单态化，为每个被调用的具体类型生成对应的特定代码
B) 运行时通过虚表查找实际类型
C) 把所有泛型值装箱分配到堆上
D) 在运行时做动态类型检查
= A
+ Rust 在编译时对泛型代码做单态化：找出泛型代码被调用的位置，用具体类型填充并生成特定代码，因此没有运行时开销。

### 要让泛型函数 fn largest<T>(list: &[T]) -> T 通过编译，T 至少需要哪些 trait bound？
~ 泛型/largest 的 trait bound
A) PartialOrd + Copy
B) Display + Clone
C) Summary + Display
D) PartialOrd + Display
= A
+ 函数体用 > 比较需要 PartialOrd；而 let mut largest = list[0] 与 for &item in list.iter() 需要把值移出/复制出来，需要 Copy。

### 假设所有相关类型和 trait 都不在本地 crate 中定义，在 aggregator crate 里下列哪种实现是允许的？
~ trait/孤儿规则
A) 为本地自定义类型 Tweet 实现标准库的 Display trait
B) 为 Vec<T> 实现标准库的 Display trait
C) 为 Vec<T> 实现标准库的 Clone trait
D) 为 i32 实现标准库的 Display trait
= A
+ 只有 trait 或要实现 trait 的类型位于 crate 本地作用域时才能实现；Tweet 是本地类型，所以可以为它实现外部的 Display。为外部类型实现外部 trait 违反孤儿规则。

### Summary trait 的 summarize 已有默认实现，若想让 NewsArticle 直接使用该默认实现而不自定义，应怎么写？
~ trait/空 impl 块使用默认实现
A) impl Summary for NewsArticle {}
B) impl Summary for NewsArticle { fn summarize(&self) -> String; }
C) 不写任何 impl，NewsArticle 会自动获得该方法
D) impl Default for NewsArticle {}
= A
+ 提供一个空的 impl 块即可指定 NewsArticle 实现 Summary，从而保留并使用默认实现。

### 关于 trait 默认实现，下列说法正确的是？
~ trait/默认实现相互调用限制
A) 默认实现可以调用同一 trait 中的其他方法（即使那个方法没有默认实现），但无法从重载实现中调用被重载掉的默认方法
B) 默认实现只能调用自身，不能调用同 trait 的其他方法
C) 重载实现中可以调用被自己重载掉的默认方法
D) 默认实现不能调用任何没有默认实现的方法
= A
+ 默认实现允许调用相同 trait 中的其他方法，哪怕这些方法没有默认实现；但无法从相同方法的重载实现中调用默认方法。

### notify(item1: impl Summary, item2: impl Summary) 与 notify<T: Summary>(item1: T, item2: T) 的关键区别是什么？
~ trait/impl Trait 与 trait bound 的类型一致性差异
A) 前者允许两个参数是不同类型（只要都实现 Summary），后者要求两者是同一具体类型
B) 前者要求两者是同一类型，后者允许不同类型
C) 两者完全等价，只是写法不同
D) 后者不能接受任何实现了 Summary 的类型
= A
+ impl Trait 写法下 item1 和 item2 可以是不同类型；使用同一个泛型参数 T 的 trait bound 则强制两个参数的具体类型一致。

### fn some_function<T, U>(t: T, u: U) -> i32 where T: Display + Clone, U: Clone + Debug 中 where 从句的作用是什么？
~ trait/where 从句
A) 把 trait bound 移到函数签名之后集中书写，使函数名、参数列表和返回值靠得更近、更易读
B) 声明泛型参数 T 和 U
C) 指定返回值必须实现 Display
D) 在运行时检查 T 和 U 是否实现了所需 trait
= A
+ 泛型参数多时，把 trait bound 放在参数列表前的尖括号里会很长；where 从句把它们移到签名之后，使签名更清晰。

### 函数签名声明为 fn returns_summarizable(switch: bool) -> impl Summary，函数体根据 switch 分别返回 NewsArticle 或 Tweet，会怎样？
~ trait/返回 impl Trait 的限制
A) 不能编译，因为返回 impl Trait 只适用于返回单一具体类型的情况
B) 编译通过，返回的具体类型在运行时决定
C) 编译通过，返回的是 trait 对象
D) 编译通过，但只会返回 Tweet
= A
+ 返回位置使用 impl Trait 只适用于返回单一类型的情况；根据条件返回 NewsArticle 或 Tweet 两种不同类型无法编译。

### 标准库中的 impl<T: Display> ToString for T 是什么，带来什么效果？
~ trait/blanket implementation
A) 是一种 blanket implementation，使任何实现了 Display 的类型都能调用 to_string
B) 是孤儿规则的例外，只对 i32 生效
C) 是一种默认实现，只有 Tweet 类型能用
D) 是有条件实现，只有 T 是 String 时才能调用 to_string
= A
+ 对任何满足特定 trait bound 的类型实现 trait 被称为 blanket implementation；因此任何实现了 Display 的类型都能调用 ToString 定义的 to_string。

### 生命周期机制的主要目标是什么？
~ 生命周期/生命周期的主要目标
A) 避免悬垂引用，确保引用在需要使用时始终有效
B) 让泛型类型在运行时才确定具体的类型
C) 提供与 trait bound 完全等价的编译期行为检查
D) 让结构体可以存放任意类型的字段
= A
+ 生命周期的主要目标是避免悬垂引用，即避免程序引用非预期引用的数据。

### 关于生命周期标注（如 'a），下列说法正确的是？
~ 生命周期/生命周期标注不改变引用的生命周期
A) 标注并不改变任何引用的实际生命周期长短，只描述多个引用生命周期之间的关系
B) 标注会延长被标注引用的实际生命周期
C) 标注会缩短被标注引用的实际生命周期
D) 标注会在运行时决定引用何时被释放
= A
+ 与泛型类型参数类似，指定泛型生命周期后函数仍能接受任何生命周期的引用；标注描述引用间的关系，不影响其生命周期。

### 对 fn longest<'a>(x: &'a str, y: &'a str) -> &'a str，返回的引用能保证有效的作用范围是？
~ 生命周期/longest 返回引用的生命周期
A) 与 x 和 y 中较短的那个生命周期一致
B) 与 x 的生命周期一致
C) 与 y 的生命周期一致
D) 与整个程序的生命周期一致（'static）
= A
+ 泛型生命周期 'a 的具体生命周期等同于 x 和 y 中较小的那一个，因此返回引用保证在较短的那个生命周期结束前有效。

### fn longest<'a>(x: &str, y: &str) -> &'a str { let result = String::from("really long string"); result.as_str() } 为什么不能编译？
~ 生命周期/返回函数内部创建值的引用
A) result 在函数结束时离开作用域并被清理，返回它的引用会成为悬垂引用，无法靠生命周期参数修复
B) 因为没有给 x 和 y 标注生命周期
C) 因为 'a 没有在尖括号中声明
D) 因为 String 没有实现 Copy
= A
+ 返回值的生命周期与参数完全没有关联；无法指定生命周期参数来让内部创建的值的引用变得有效，Rust 不允许创建悬垂引用。

### struct ImportantExcerpt<'a> { part: &'a str } 中的生命周期标注意味着什么？
~ 生命周期/结构体定义中的生命周期标注
A) ImportantExcerpt 的实例不能比其 part 字段中的引用存在得更久
B) part 字段的数据不能比 ImportantExcerpt 实例存在得更久
C) part 必须是 'static 的字符串字面量
D) 结构体内部持有 part 所引用数据的所有权
= A
+ 类似于泛型参数，用于引用的结构体必须在名称后的尖括号中声明生命周期参数；该标注意味着实例不能比其 part 字段中的引用存在得更久。

### 生命周期省略的第三条规则适用于什么情况，效果如何？
~ 生命周期/生命周期省略第三条规则
A) 方法有多个输入生命周期参数且其中一个是 &self 或 &mut self 时，所有输出生命周期被赋予 self 的生命周期
B) 函数只有一个输入生命周期参数时，把它赋予所有输出生命周期
C) 每个引用参数都获得各自独立的生命周期参数
D) 返回值总是被赋予 'static 生命周期
= A
+ 第三条规则针对方法：多个输入生命周期中若有 &self 或 &mut self，则输出生命周期都被赋予 self 的生命周期，使方法签名更简洁。

## 编写自动化测试

### 在 Rust 中，要把一个普通函数变成测试函数，需要在 `fn` 行之前加上什么？
~ 编写自动化测试/test 属性
A) `#[cfg(test)]`
B) `#[test]`
C) `#[ignore]`
D) `#[should_panic]`
= B
+ 本节说明，`#[test]` 属性标明这是一个测试函数，测试执行者会将其作为测试处理。

### `assert!` 宏收到的参数求值为 `false` 时会发生什么？
~ 编写自动化测试/assert! 宏
A) 打印一条警告，测试仍然通过
B) 导致编译失败
C) 调用 `panic!` 宏，导致测试失败
D) 返回 `Err` 值，测试继续运行
= C
+ 本节说：值为 `false` 时 `assert!` 调用 `panic!` 宏，这会导致测试失败。

### 与 `assert!` 相比，`assert_eq!` 断言失败时额外打印出什么？
~ 编写自动化测试/assert_eq! 失败输出
A) 完整的调用栈
B) 被比较的两个值分别是什么
C) 测试函数所在的模块名
D) 测试运行所花费的时间
= B
+ `assert_eq!`/`assert_ne!` 失败时会打印两个值具体是什么，而 `assert!` 只会打印从 `==` 表达式得到 `false`。

### 在 Rust 的 `assert_eq!` 中，关于两个参数顺序的说法哪项正确？
~ 编写自动化测试/assert_eq! 参数顺序
A) 第一个参数必须是期望值，否则测试结果不可靠
B) 第一个参数必须是被测代码产生的值，否则会编译失败
C) 顺序不重要，交换两个参数只会让失败信息里的 `left` 和 `right` 对调
D) 顺序错误时宏会忽略第二个参数
= C
+ Rust 中这两个参数叫 `left` 和 `right`，指定期望值和被测值的顺序并不重要，交换只改变失败信息中的左右显示。

### 用 `assert_eq!` 比较自定义结构体的两个实例，该结构体至少需要实现哪两个 trait？
~ 编写自动化测试/断言宏的 trait 要求
A) `Eq` 和 `Display`
B) `Hash` 和 `Ord`
C) `Clone` 和 `Copy`
D) `PartialEq` 和 `Debug`
= D
+ 断言失败时宏会用调试格式打印参数，所以被比较的值需要实现 `PartialEq` 和 `Debug`。

### 在 `assert!`、`assert_eq!` 和 `assert_ne!` 的必需参数之后附加的参数会怎样处理？
~ 编写自动化测试/自定义失败信息
A) 必须全部是字符串字面量，否则编译失败
B) 只在测试通过时打印出来
C) 被测试库忽略，仅用于文档
D) 传递给 `format!` 宏，用于生成失败时打印的自定义信息
= D
+ 本节说这些额外参数都会传递给 `format!` 宏，可包含 `{}` 占位符和对应值。

### 一个标有 `#[should_panic]` 的测试函数在什么情况下通过？
~ 编写自动化测试/should_panic 属性
A) 函数中的代码不 panic 时通过，panic 时失败
B) 函数中的代码发生 panic 时通过，没有 panic 时失败
C) 无论是否 panic 都通过
D) 只在 release 构建中 panic 时通过
= B
+ `should_panic` 属性在函数中的代码 panic 时通过，而在其没有 panic 时失败。

### `#[should_panic(expected = "...")]` 中 `expected` 指定的字符串如何与 panic 信息匹配？
~ 编写自动化测试/should_panic 的 expected 参数
A) panic 信息必须与该字符串完全相等
B) panic 信息需要包含该字符串作为子串
C) 该字符串被当作正则表达式匹配
D) 该字符串只与测试函数名比较
= B
+ 本节说明测试工具会确保错误信息中包含 `expected` 提供的文本，即子串匹配。

### 一个返回 `Result<T, E>` 的测试函数能否同时标注 `#[should_panic]`？
~ 编写自动化测试/Result 测试与 should_panic
A) 能，两者可以任意组合
B) 不能，`#[should_panic]` 不能用于返回 `Result<T, E>` 的测试
C) 能，但只在 nightly 上有效
D) 能，只要再加 `#[ignore]` 即可
= B
+ 本节明确指出不能在使用 `Result<T, E>` 的测试中使用 `#[should_panic]` 注解。

### 在用 `Result<T, E>` 编写的测试中，要断言某个操作返回 `Err`，应该怎么做？
~ 编写自动化测试/Result 测试断言 Err
A) 对该值使用 `?` 运算符，让测试自动失败
B) 把该值传给 `assert_eq!` 与 `Ok(())` 比较
C) 使用 `assert!(value.is_err())`，而不是对该值使用 `?` 运算符
D) 在测试函数上加 `#[should_panic]`
= C
+ 本节建议：要断言操作返回 `Err` 值，不要对 `Result` 使用 `?`，而应使用 `assert!(value.is_err())`。

### 默认情况下，`cargo test` 如何运行一个测试集中的多个测试？
~ 编写自动化测试/默认并行运行
A) 严格按声明顺序逐个运行
B) 随机挑选一个运行
C) 只运行名称最长的测试
D) 使用线程并行运行
= D
+ 当运行多个测试时，Rust 默认使用线程并行运行，因此测试不应相互依赖或依赖共享状态。

### 要让测试二进制以单线程连续运行测试，正确的命令是？
~ 编写自动化测试/--test-threads 参数
A) `cargo test --test-threads=1`（不加分隔符）
B) `cargo test --serial`
C) `cargo test -- --test-threads=1`
D) `cargo test -- --parallel=1`
= C
+ 传给测试二进制文件的参数要放在 `--` 之后，所以是 `cargo test -- --test-threads=1`。

### 默认情况下，一个通过的测试中调用 `println!` 打印的内容会怎样？
~ 编写自动化测试/测试输出截获
A) 总是原样显示在终端
B) 被写入标准错误流
C) 导致该测试被标记为失败
D) 被测试库截获，不会显示在终端
= D
+ 默认当测试通过时，测试库会截获打印到标准输出的所有内容；只有测试失败时才会看到这些输出。

### 一个同时标有 `#[test]` 和 `#[ignore]` 的测试，默认 `cargo test` 时会怎样？又该如何单独运行它？
~ 编写自动化测试/ignore 属性
A) 默认照常运行；用 `cargo test -- --ignored` 跳过它
B) 默认被跳过；用 `cargo test --ignore` 运行它
C) 默认被跳过；被忽略的测试永远无法运行
D) 默认被跳过；用 `cargo test -- --ignored` 运行被忽略的测试
= D
+ `#[ignore]` 标记的测试默认不运行，摘要中记为 ignored；用 `cargo test -- --ignored` 可以只运行它们。

### 测试模块上的 `#[cfg(test)]` 标注起什么作用？
~ 编写自动化测试/#[cfg(test)] 的作用
A) 把模块中的每个函数都标记为测试函数
B) 只在执行 `cargo test` 时编译和运行该模块，`cargo build` 时不编译
C) 让模块中的测试默认被忽略
D) 让模块中的测试并行运行
= B
+ `cfg` 代表 configuration，`test` 配置使该模块只在 `cargo test` 时才被编译，节省构建时间和产物体积。

### 关于在 Rust 中测试私有函数，哪项说法正确？
~ 编写自动化测试/测试私有函数
A) 不可以，私有函数必须先改成 `pub` 才能测试
B) 可以，因为 `tests` 也是模块，能导入并调用父模块中的私有函数
C) 只能用集成测试来测私有函数
D) 需要给私有函数加上 `#[cfg(test)]` 才能测试
= B
+ Rust 的私有性规则允许测试私有函数：测试代码也是 Rust 代码，`tests` 只是另一个模块，可以导入父模块的私有项。

### 按照本节的约定，集成测试文件应该放在项目的哪个位置？
~ 编写自动化测试/集成测试目录
A) *src* 目录内的 *tests* 子目录中
B) 与 *Cargo.toml* 同级的 *benches* 目录中
C) 与 *src* 同级的 *tests* 目录中
D) 任意位置，Cargo 会自动搜索
= C
+ 集成测试需要放在项目根目录下与 *src* 同级的 *tests* 目录中，Cargo 知道如何寻找其中的集成测试文件。

### 每个 *tests* 目录中的集成测试文件为什么通常需要在顶部写 `use adder;`？
~ 编写自动化测试/集成测试导入库
A) 为了给文件启用 `#[test]` 属性
B) 每个测试文件都被编译为独立的 crate，需要导入要测试的库
C) 为了让 Cargo 认出这是集成测试文件
D) 为了自动加载 `#[cfg(test)]` 模块
= B
+ *tests* 目录中的每个文件都被当作单独的 crate 编译，所以要在每个文件中导入库。

### 多个集成测试文件都要用到的辅助函数 `setup`，怎样放置才不会让 Cargo 把它当成一个独立的集成测试 crate？
~ 编写自动化测试/集成测试共享辅助模块
A) 放在 *tests/common.rs* 中
B) 放在 *tests/common/mod.rs* 中，并在测试文件里写 `mod common;`
C) 放在 *src/common.rs* 中
D) 在每个测试文件里各复制一份
= B
+ 把辅助代码放到 *tests/common/mod.rs* 这种子目录模块中，Cargo 就不会把 *common* 作为独立 crate 编译，也不会在输出中出现 `running 0 tests` 的部分。

### 一个只包含 *src/main.rs* 而没有 *src/lib.rs* 的二进制 crate，能否在 *tests* 目录中编写集成测试并用 `use` 导入其中的函数？
~ 编写自动化测试/二进制 crate 的集成测试
A) 能，只要函数标了 `pub` 就可以
B) 能，只要在 *Cargo.toml* 中声明 `[lib]` 路径为 *src/main.rs*
C) 不能，二进制 crate 不向其他 crate 暴露可调用的函数
D) 能，但必须在 `#[cfg(test)]` 模块中导入
= C
+ 只有库 crate 才向其他 crate 暴露可供调用和使用的函数；二进制 crate 只意在单独运行，所以需要把逻辑放到 *src/lib.rs* 中才能集成测试。

## 一个 I/O 项目：构建命令行程序

### `std::env::args` 函数返回什么？
~ 一个 i/o 项目：构建命令行程序/命令行参数迭代器
A) 一个传递给程序的命令行参数的迭代器
B) 一个包含命令行参数的 String
C) 一个表示环境变量数量的整数
D) 一个文件路径的切片
= A
+ `std::env::args` 返回命令行参数的迭代器，可以再用 `collect` 转成集合。

### 为什么示例中写 `let args: Vec<String> = env::args().collect();` 要显式注明 `Vec<String>`？
~ 一个 i/o 项目：构建命令行程序/用 collect 收集参数
A) 因为 collect 可以创建多种集合类型，Rust 不能推断出想要哪种集合
B) 因为 env::args 只能收集为 Vec<String>，不注明会编译错误
C) 因为不注明类型程序会在运行时 panic
D) 因为 String 是唯一实现 Iterator 的类型
= A
+ `collect` 能创建多种集合，所以常需要类型标注来指明目标集合类型。

### 在 `cargo run needle haystack` 运行时，收集到的参数 vector 的第一个元素 `args[0]` 是什么？
~ 一个 i/o 项目：构建命令行程序/程序名参数
A) 二进制文件的名称，例如 "target/debug/minigrep"
B) 第一个用户参数 "needle"
C) 第二个用户参数 "haystack"
D) 空字符串
= A
+ 与 C 的参数列表类似，第一个值是程序被调用时的二进制名称。

### 为什么示例中使用 `use std::env;` 然后在代码里调用 `env::args()`，而不是直接 `use std::env::args;` 后调用 `args()`？
~ 一个 i/o 项目：构建命令行程序/引入 env 模块
A) 这样可以利用 std::env 中的其他函数，并且避免 args 被误认成当前模块的函数
B) 因为 `use std::env::args;` 不是合法的 Rust 语法
C) 因为直接使用 `args()` 会导致每次调用创建新进程
D) 因为只有引入父模块才能调用 args，引入函数本身不能调用
= A
+ 引入父模块更明确，也便于使用 `std::env` 中的其他函数。

### 如果程序需要接受包含无效 Unicode 字符的命令行参数，应该使用哪个函数？
~ 一个 i/o 项目：构建命令行程序/无效 unicode 参数
A) `std::env::args_os`，它返回 `OsString` 值
B) `std::env::args`，它自动把无效 Unicode 替换为问号
C) `std::fs::read_to_string`，它可以直接读取参数
D) `std::process::exit`，它可以绕过 Unicode 检查
= A
+ `args` 遇到无效 Unicode 会 panic；`args_os` 返回 `OsString`，可处理这类参数。

### `fs::read_to_string(filename)` 的返回类型是什么？
~ 一个 i/o 项目：构建命令行程序/读取文件内容
A) `Result<String>`
B) `String`
C) `Option<String>`
D) `Vec<String>`
= A
+ `fs::read_to_string` 打开文件并返回包含内容的 `Result<String>`。

### 按照二进制项目关注分离的指导过程，重构后保留在 `main` 函数中的责任不应该包括下列哪一项？
~ 一个 i/o 项目：构建命令行程序/关注分离中 main 的职责
A) 实现搜索文件内容并返回匹配行的核心逻辑
B) 使用参数值调用命令行解析逻辑
C) 设置任何其他的配置
D) 如果 `run` 返回错误则处理这个错误
= A
+ 核心逻辑应放入 `lib.rs` 的 `run` 等函数中，以便测试；`main` 只保留配置、调用和错误处理。

### `parse_config` 返回 `(&str, &str)` 后马上在 `main` 中拆成 `query` 和 `filename`，这提示了什么改进？
~ 一个 i/o 项目：构建命令行程序/parse_config 返回元组的问题
A) 这两个值是相关的配置，应将它们放入一个带字段名的结构体
B) 应改用 `Vec<&str>` 返回，避免元组
C) 应删除 `parse_config`，把解析逻辑写回 `main`
D) 应把 `filename` 改为整数类型
= A
+ 返回元组后立即拆开是抽象不合适的信号，使用结构体能表达字段含义和关联。

### 在 `Config::new` 中为什么对 `args[1]` 和 `args[2]` 调用 `clone()` 来得到 `query` 和 `filename`？
~ 一个 i/o 项目：构建命令行程序/config 使用 clone 的原因
A) 因为 `args` 是参数值的所有者，`Config` 需要拥有 `String`，而 `args` 只允许借用，clone 得到拥有所有权的拷贝
B) 因为 `clone()` 是访问 vector 元素的唯一方式
C) 因为不调用 `clone()` 就无法使用索引访问 `args`
D) 因为 `String` 类型没有实现任何借用方法
= A
+ `Config` 需要拥有字符串数据，而传入的 `args` 只被借用，所以用 `clone` 生成拥有所有权的拷贝。

### 示例 12-9 中 `Config::new` 在参数不足时如何表示错误？
~ 一个 i/o 项目：构建命令行程序/config::new 返回 result
A) 返回 `Err("not enough arguments")`
B) 调用 `println!` 后返回 `Config { ... }`
C) 返回 `None`
D) 直接调用 `process::exit(0)`
= A
+ `Config::new` 返回 `Result`，参数不足时返回 `Err` 字符串字面量。

### `Config::new(&args).unwrap_or_else(|err| { ... })` 中，当 `Config::new` 返回 `Err` 时会发生什么？
~ 一个 i/o 项目：构建命令行程序/unwrap_or_else 处理错误
A) 调用闭包，并把 `Err` 内部的值作为参数 `err` 传入
B) 直接 panic 并打印默认错误
C) 返回 `Ok` 内部的值并忽略错误
D) 把 `Err` 转换成 `Ok` 后继续运行
= A
+ `unwrap_or_else` 在 `Ok` 时返回值，在 `Err` 时把错误值传入闭包执行自定义处理。

### 在错误处理闭包中调用 `process::exit(1)` 的作用是什么？
~ 一个 i/o 项目：构建命令行程序/process::exit 退出码
A) 立即停止程序，并把 1 作为退出状态码，表示程序以错误状态退出
B) 仅打印错误后继续执行 `main` 的剩余部分
C) 把标准输出重定向到文件
D) 让程序进入休眠 1 秒后重试
= A
+ 非零退出状态码是告诉调用方程序以错误状态退出的惯例信号。

### `run` 函数的返回类型 `Result<(), Box<dyn Error>>` 中 `Box<dyn Error>` 意味着什么？
~ 一个 i/o 项目：构建命令行程序/run 返回 box dyn error
A) 返回实现了 `Error` trait 的类型，但无需指定具体是哪种错误类型
B) 返回一个固定为字符串字面量的错误
C) 返回一个整数错误码
D) 返回一个必须为 `std::io::Error` 的具体错误
= A
+ `Box<dyn Error>` 表示错误类型是实现 `Error` 的某个类型，`dyn` 表示动态。

### `run` 成功时返回 `Ok(())`，这里的 `()` 表示什么？
~ 一个 i/o 项目：构建命令行程序/run 中 ok(()) 的意义
A) unit 类型，表明调用 `run` 只是为了副作用，函数没有返回有意义的值
B) 一个空字符串
C) 一个空 vector
D) 一个表示成功次数的计数器
= A
+ `()` 是 unit 类型，`Ok(())` 表示成功但没有有意义的值要返回。

### `pub fn search<'a>(query: &str, contents: &'a str) -> Vec<&'a str>` 中，生命周期 `'a` 主要告诉 Rust 什么？
~ 一个 i/o 项目：构建命令行程序/search 生命周期标注
A) 返回的字符串 slice 与 `contents` 活得一样久，而不是与 `query` 关联
B) `query` 必须比 `contents` 活得更久
C) 返回的 vector 在堆上分配，因此不需要生命周期
D) `query` 和 `contents` 必须是同一类型
= A
+ 返回的 slice 来自 `contents`，所以用 `'a` 把返回值和 `contents` 的生命周期关联起来。

### 在实现 `search` 时，如何使用 `contents` 逐行遍历文本？
~ 一个 i/o 项目：构建命令行程序/lines 方法遍历
A) 调用 `contents.lines()` 获得每一行
B) 调用 `contents.chars()` 获得每一行
C) 调用 `contents.bytes()` 获得每一行
D) 直接 `for line in contents` 即可逐行遍历
= A
+ `lines` 方法逐行遍历字符串，每行不包含换行符。

### 在 `search` 函数中，如何检查当前行是否包含查询字符串 `query`？
~ 一个 i/o 项目：构建命令行程序/contains 检查子串
A) `line.contains(query)`
B) `query.contains(line)`
C) `line == query`
D) `line.starts_with(query) && line.ends_with(query)`
= A
+ `contains` 方法检查字符串中是否包含给定子串。

### `search_case_insensitive` 如何实现大小写不敏感匹配？
~ 一个 i/o 项目：构建命令行程序/大小写不敏感搜索实现
A) 将 `query` 和每一行都调用 `to_lowercase()` 后再用 `contains` 检查
B) 只将 `query` 转为小写，行保持原样
C) 只将每一行转为小写，查询保持原样
D) 使用 `==` 比较原始大小写
= A
+ 把查询和行都转成小写后比较，就能忽略大小写差异。

### `let case_sensitive = env::var("CASE_INSENSITIVE").is_err();` 的逻辑是什么？
~ 一个 i/o 项目：构建命令行程序/环境变量 case_insensitive
A) 环境变量未设置时 `is_err()` 为 true，表示进行大小写敏感搜索；设置了任意值则进行大小写不敏感搜索
B) 环境变量设置为 "1" 时 `is_err()` 为 true，表示大小写敏感
C) 环境变量未设置时程序会 panic
D) `is_err()` 返回环境变量的字符串值
= A
+ `env::var` 未找到变量时返回 `Err`，`is_err()` 为 true，因此默认大小写敏感。

### 为什么要把 `main` 中打印错误信息的 `println!` 改为 `eprintln!`？
~ 一个 i/o 项目：构建命令行程序/eprintln 打印标准错误
A) 因为错误信息应写入标准错误，这样重定向标准输出到文件时错误信息仍显示在屏幕上
B) 因为 `eprintln!` 比 `println!` 打印速度更快
C) 因为 `println!` 不能打印字符串
D) 因为 `eprintln!` 会自动调用 `process::exit(1)`
= A
+ `eprintln!` 打印到标准错误，符合命令行程序将错误与普通输出分开的惯例。

## Rust 中的函数式语言功能：迭代器与闭包

### 在 Rust 中，如何定义一个闭包并将其存储到变量 `expensive_closure` 中？
~ closures/definition
A) let expensive_closure = |num| { num };
B) let expensive_closure = fn(num) { num };
C) let expensive_closure = closure(num) { num };
D) let expensive_closure = |num| -> { num };
= A
+ 闭包定义以一对竖线开始指定参数，后跟闭包体，可存储到变量中。

### 关于闭包和函数捕获环境的能力，下列哪项正确？
~ closures/environment-capture
A) 闭包可以捕获其定义作用域中的变量，函数不能。
B) 函数可以捕获其定义作用域中的变量，闭包不能。
C) 闭包和函数都可以捕获环境变量。
D) 闭包和函数都不能捕获环境变量。
= A
+ 闭包允许捕获调用者作用域中的值，而函数不能捕获动态环境。

### 示例 13-8 中，闭包 `let example_closure = |x| x;` 先用 `String` 调用，再用 `u32` 调用，会发生什么？
~ closures/type-inference
A) 编译错误，因为闭包参数类型已被推断并锁定为 String。
B) 正常运行，因为闭包是泛型的。
C) 运行时错误，因为类型不匹配。
D) 编译通过，但第二次调用返回 0。
= A
+ 闭包会为参数和返回值推断一个具体类型，第一次调用后类型被锁定，再用不同类型会编译错误。

### 一个闭包如果只不可变借用地捕获环境变量，它实现了哪个 Fn 系列 trait？
~ closures/Fn-traits
A) Fn
B) FnMut
C) FnOnce
D) 以上都不实现
= A
! 固定顺序
+ Fn 从其环境获取不可变借用值；只读捕获的闭包实现 Fn。

### 在闭包参数列表前使用 `move` 关键字的作用是什么？
~ closures/move
A) 强制闭包获取其使用的环境值的所有权。
B) 使闭包可以多次调用。
C) 让闭包只能被调用一次。
D) 禁止闭包捕获任何环境变量。
= A
+ move 关键字强制闭包获取其使用的环境值的所有权。

### `Cacher` 结构体的主要目的是什么？
~ closures/Cacher-purpose
A) 缓存闭包的计算结果，只在需要时执行闭包一次。
B) 每次调用都重新执行闭包以获取最新结果。
C) 存储多个不同的闭包并根据参数选择。
D) 将闭包转换为迭代器。
= A
+ Cacher 存放闭包和 Option 结果值，只在需要结果时执行闭包并缓存结果。

### 为什么 `Cacher` 的测试 `call_with_different_values` 会失败？
~ closures/Cacher-limitation
A) 它第一次调用 `value(1)` 后将结果 `Some(1)` 缓存，之后 `value(2)` 仍返回 1。
B) 因为闭包 `|a| a` 没有实现 Fn trait。
C) 因为 `Cacher` 的 `value` 字段不是 `Option` 类型。
D) 因为 `Cacher` 没有实现 `Iterator` trait。
= A
+ 当前 Cacher 假设任何 arg 都返回相同值，只缓存第一个结果，因此不同参数调用会得到旧值。

### 执行 `v1.iter().map(|x| x + 1);` 而不调用消费适配器，会发生什么？
~ iterators/laziness
A) 编译器给出未使用 `Map` 的警告，闭包不会执行，没有实际效果。
B) 立即对每个元素加 1 并生成新 vector。
C) 运行时 panic，因为迭代器未消费。
D) 自动调用 `collect` 将结果收集到 vector。
= A
+ 迭代器适配器是惰性的，必须调用消费适配器才会执行；单独调用 map 会产生未使用警告。

### 实现 `Iterator` trait 时，唯一必须定义的方法是哪一项？
~ iterators/Iterator-trait-required-method
A) `next`
B) `map`
C) `filter`
D) `sum`
= A
+ Iterator trait 要求实现者定义 next 方法，其他方法有默认实现。

### 要创建一个获取 vector 所有权并返回拥有所有权元素的迭代器，应调用哪个方法？
~ iterators/iter-vs-into_iter
A) `into_iter`
B) `iter`
C) `iter_mut`
D) `next`
= A
+ into_iter 获取所有权并返回拥有所有权的迭代器；iter 返回不可变引用迭代器。

### 下列哪个方法是消费适配器（consuming adaptor）？
~ iterators/consuming-adaptor
A) `sum`
B) `map`
C) `filter`
D) `zip`
= A
+ sum 获取迭代器所有权并反复调用 next 遍历迭代器，是消费适配器。

### 迭代器适配器 `map` 的作用是什么？
~ iterators/adaptor-map
A) 用闭包转换每个元素并返回一个新的迭代器。
B) 过滤掉不满足条件的元素。
C) 将所有元素求和。
D) 将迭代器收集到 vector 中。
= A
+ map 使用闭包转换每个元素，产生新的迭代器，属于迭代器适配器。

### 传给 `filter` 的闭包必须返回什么类型？
~ iterators/filter-closure-return
A) `bool`
B) 与迭代器元素相同的类型
C) `Option<T>`
D) 一个迭代器
= A
+ filter 的闭包对每个项返回布尔值，true 保留，false 丢弃。

### 在 `Counter` 迭代器示例中，当 `count` 达到 6 时，`next` 方法返回什么？
~ iterators/custom-counter-next
A) `None`
B) `Some(6)`
C) `Some(0)`
D) 触发 panic
= A
+ Counter 的 next 在 count 小于 6 时返回 Some(count)，否则返回 None。

### 在 `Counter` 示例的 `zip` 链中，为什么只产生四对值而不是五对？
~ iterators/zip-stops
A) `zip` 在任一输入迭代器返回 `None` 时也返回 `None`，所以第五对 `(5, None)` 不会被产生。
B) `zip` 会自动跳过第一个元素。
C) `zip` 只保留能被 3 整除的结果。
D) `zip` 会调用 `collect` 并截断结果。
= A
+ zip 在任一输入迭代器返回 None 时结束，因此不会产生包含 None 的第五对值。

### `env::args` 返回一个迭代器。对它第一次调用 `next` 会得到什么？
~ iterators/env-args-first-next
A) 程序的名称。
B) 第一个用户提供的命令行参数。
C) `None`。
D) 空字符串。
= A
+ env::args 返回值的第一个值是程序的名称，处理参数时通常先调用 next 忽略它。

### 将 `Config::new` 改为接受 `std::env::Args` 迭代器后，为什么可以避免 `clone`？
~ iterators/config-new-avoid-clone
A) 因为 `Config::new` 获取了迭代器的所有权，可以直接将 `String` 值移动进 `Config` 字段。
B) 因为迭代器中的 `String` 都实现了 `Copy`。
C) 因为 `Config` 字段改用 `&str` 引用。
D) 因为 `env::args` 返回的是 `Vec<String>`，可以直接索引。
= A
+ 获取迭代器所有权后，可以通过 next 取得 String 并移动进 Config，无需克隆。

### 在改进后的 `search` 函数中，`filter(|line| line.contains(query))` 的作用是什么？
~ iterators/search-filter-collect
A) 只保留包含 `query` 的行。
B) 将每一行转换为大写。
C) 对所有行求和。
D) 按字母顺序排序行。
= A
+ filter 用闭包判断每行是否包含查询字符串，只保留返回 true 的行。

### 在 Rust 中，迭代器被称为“零成本抽象”意味着什么？
~ iterators/zero-cost-abstraction
A) 使用迭代器这类抽象不会引入运行时开销，编译后的性能可与手写底层代码相当。
B) 迭代器在运行时完全不需要内存。
C) 迭代器总是比手写循环快很多。
D) 迭代器是惰性的，所以不消耗任何 CPU。
= A
+ 零成本抽象表示高级抽象不会带来运行时开销，迭代器编译后可达到与手写底层代码相近的性能。

### 如果一个闭包不需要捕获环境中的值，可以用什么替代它？
~ closures/functions-implement-Fn
A) 一个实现了 `Fn` trait 的函数。
B) 一个 trait 对象。
C) 一个宏。
D) 一个结构体。
= A
+ 函数实现了 Fn 系列 trait；如果不需要捕获环境，可以使用函数而不是闭包。

## 更多关于 Cargo 和 Crates.io 的内容

### 运行 `cargo build` 时，Cargo 使用哪个发布配置？
~ 发布配置/构建命令与配置对应
A) release
B) dev
C) debug
= B
+ `cargo build` 采用 `dev` 配置，`cargo build --release` 采用 `release` 配置。

### 当 Cargo.toml 中没有任何 `[profile.*]` 定制时，`dev` 和 `release` 配置的 `opt-level` 默认值分别是多少？
~ 发布配置/opt-level 默认值
A) dev 为 3，release 为 0
B) dev 为 0，release 为 3
C) dev 为 0，release 为 0
D) dev 为 3，release 为 3
= B
+ `dev` 的 `opt-level` 默认为 0，`release` 的 `opt-level` 默认为 3。

### `opt-level` 设置的作用和取值范围是什么？
~ 发布配置/opt-level 含义与范围
A) 控制编译时包含多少调试信息，取值 0 到 3
B) 控制 Rust 会对代码进行何种程度的优化，取值 0 到 5
C) 控制 Rust 会对代码进行何种程度的优化，取值 0 到 3
D) 控制并行编译的线程数，取值 1 到 3
= C
+ `opt-level` 控制 Rust 对代码进行何种程度的优化，值从 0 到 3。

### 要在开发构建中使用级别 1 的优化，应在 Cargo.toml 中增加什么？
~ 发布配置/覆盖默认设置
A) `[profile.release]` 部分并写入 `opt-level = 1`
B) `[profile.dev]` 部分并写入 `opt-level = 1`
C) `[package]` 部分并写入 `opt-level = 1`
D) `[dev]` 部分并写入 `optimization = 1`
= B
+ 在 `[profile.dev]` 中设置 `opt-level = 1` 会覆盖默认值 0。

### Rust 中用于生成 HTML 文档的文档注释使用什么符号开头？
~ 文档注释/语法
A) 两斜杠 `//`
B) 三斜杠 `///`
C) 星号 `/*`
D) 井号 `#`
= B
+ 文档注释使用三斜杠 `///`，并支持 Markdown 标记。

### `cargo doc` 命令生成的 HTML 文档被放入哪个目录？
~ 文档注释/cargo doc 输出目录
A) target/debug
B) src/doc
C) target/doc
D) doc/target
= C
+ `cargo doc` 运行 `rustdoc`，生成的 HTML 文档放入 *target/doc*。

### 通过 `cargo install` 安装的二进制文件默认放到哪里？
~ cargo install/安装位置
A) 当前项目的 target/release 目录
B) Rust 安装根目录的 bin 文件夹（如 $HOME/.cargo/bin）
C) ~/.cargo/credentials
D) /usr/local/lib
= B
+ 所有来自 `cargo install` 的二进制文件都安装到 Rust 安装根目录的 *bin* 文件夹，通常是 `$HOME/.cargo/bin`。

### 对于可能 panic 的函数，文档注释中用来描述其 panic 场景的常用部分是？
~ 文档注释/常用部分 panics
A) # Errors
B) # Safety
C) # Panics
D) # Examples
= C
+ `Panics` 部分描述函数可能会 `panic!` 的场景；`Errors` 用于返回 `Result` 的函数，`Safety` 用于 `unsafe` 代码。

### 文档注释中的示例代码块会如何被 `cargo test` 对待？
~ 文档注释/文档测试
A) 被忽略，不参与测试
B) 像测试一样运行其中的示例代码
C) 只在 cargo doc 时检查语法
D) 被编译进最终二进制
= B
+ `cargo test` 也会像测试那样运行文档注释中的示例代码，这样代码与例子不同步时会被发现。

### `//!` 风格的文档注释为谁添加文档？
~ 文档注释/内部文档注释 //!
A) 注释之后的项
B) 包含该注释的项（如 crate 根或模块）
C) 整个工作空间的所有 crate
D) 只有被 pub 修饰的项
= B
+ `//!` 为包含注释的项添加文档，常用于 crate 根文件或模块根文件；`///` 则为注释之后的项增加文档。

### `pub use` 的作用是什么？
~ pub use/重导出
A) 把私有项变为公有项但不改变路径
B) 仅在测试时引入外部 crate
C) 重导出位于其他位置的公有项，使公有 API 结构不同于内部结构
D) 将 crate 发布到 crates.io
= C
+ `pub use` 获取位于一个位置的公有项并将其公开到另一个位置，好像它就定义在这个新位置一样。

### 运行 `cargo login <token>` 后，API token 被存储在哪里？
~ crates.io 账号/cargo login token 存储
A) Cargo.toml 的 `[package]` 部分
B) ~/.cargo/credentials
C) ~/.cargo/bin
D) target/doc
= B
+ `cargo login` 会把 API token 存储在本地 *~/.cargo/credentials* 中，该 token 是秘密且不应共享。

### 在 Cargo.toml 的 `[package]` 中，发布 crate 时因缺失而导致错误的两项关键元信息是什么？
~ 发布 crate/必需元数据
A) authors 和 edition
B) description 和 license
C) homepage 和 repository
D) version 和 name
= B
+ 缺少描述与 license 会导致 `cargo publish` 报错：missing or empty metadata fields: description, license。

### `license` 字段应使用什么形式的值？
~ 发布 crate/license 标识符
A) license 文件的完整路径
B) SPDX 的 license 标识符，如 MIT
C) license 全文文本
D) 任意描述性字符串
= B
+ `license` 需要一个 license 标识符值，SPDX 列出了可用的标识符；若不在 SPDX 中则用 `license-file` 指定文件。

### 关于已发布到 crates.io 的 crate 版本，下列说法正确的是？
~ 发布 crate/永久性
A) 可以在发布后覆盖同一版本的内容
B) 可以在发布后删除某个版本的代码
C) 版本不可能被覆盖，代码也不可能被删除
D) 只能由原作者通过 cargo yank 删除代码
= C
+ 发布是永久性的：对应版本不可能被覆盖，其代码也不可能被删除；`cargo yank` 也不删除任何代码。

### `cargo yank --vers 1.0.1` 的效果是什么？
~ cargo yank/语义
A) 删除该版本的代码，使所有项目都无法再使用它
B) 阻止新项目依赖该版本，但现有带 Cargo.lock 的项目仍能下载和使用它
C) 把该版本标记为弃用但允许新项目继续依赖
D) 把依赖该版本的所有项目自动升级到新版本
= B
+ 撤回阻止新项目开始依赖此版本，不过所有现存此依赖的项目仍然能够下载和依赖这个版本。

### 如何撤销对某个版本的撤回操作，使项目可以再次依赖它？
~ cargo yank/撤销撤回
A) cargo publish --undo 1.0.1
B) cargo unyank --vers 1.0.1
C) cargo yank --vers 1.0.1 --undo
D) 删除 Cargo.lock 后重新构建
= C
+ 在 `cargo yank --vers 1.0.1` 基础上增加 `--undo` 可撤销撤回操作。

### 工作空间是一系列什么样的包？
~ 工作空间/定义
A) 共享同样的 crate 名称前缀的包
B) 必须全部是库 crate 的包
C) 共享同样的 Cargo.lock 和输出目录的包
D) 发布到同一个 crates.io 账号下的包
= C
+ 工作空间是一系列共享同样的 *Cargo.lock* 和输出目录的包。

### 在工作空间中进入某个成员 crate 目录运行 `cargo build`，构建结果位于哪里？
~ 工作空间/target 目录
A) 该成员 crate 目录自己的 target 目录
B) 每个成员 crate 各自独立的 target 目录
C) 工作空间根目录的 target 目录
= C
+ 工作空间在顶级目录有一个 target 目录；即使进入成员目录构建，结果也位于根 target 目录。

### 在工作空间中，`adder` crate 想使用 `add-one` crate 的函数，需要做什么？
~ 工作空间/依赖声明
A) 无需声明，Cargo 会自动假定工作空间内 crate 相互依赖
B) 在 adder/Cargo.toml 中把 add-one 声明为路径依赖
C) 只能在根 Cargo.toml 中声明依赖
D) 需要先把 add-one 发布到 crates.io
= B
+ Cargo 并不假定工作空间中的 crate 会相互依赖，所以需要在 adder/Cargo.toml 中明确声明路径依赖。

## 智能指针

### 使用 `Box::new(5)` 创建 `b` 后，`5` 和 `b` 本身分别存放在哪里？
~ 智能指针/box 的堆存储与栈指针
A) `5` 在堆上，`b` 是指向堆数据的栈上指针
B) `5` 在栈上，`b` 在堆上
C) 两者都在栈上
D) 两者都在堆上
= A
+ box 允许将值放在堆上，留在栈上的是指向堆数据的指针。

### 根据本节，下列哪一项不是 `Box<T>` 的典型使用场景？
~ 智能指针/box 的适用场景
A) 在编译时未知大小但需要确切大小的上下文中使用该类型值
B) 转移大量数据所有权时避免在栈上拷贝数据
C) 需要多个所有者共享同一堆数据时
D) 希望拥有一个只关心实现了特定 trait 的值
= C
+ 多个所有者共享同一堆数据是 `Rc<T>` 的用途；`Box<T>` 是单一所有权。

### `enum List { Cons(i32, List), Nil }` 编译失败的根本原因是什么？
~ 智能指针/递归类型需要已知大小
A) `Cons` 成员缺少 `Box`，导致堆分配失败
B) `List` 是递归类型，Rust 无法在编译时计算其大小
C) 枚举成员不能包含 `i32`
D) `Nil` 没有被定义为结构体
= B
+ 递归类型的大小可以无限嵌套，Rust 无法在编译时计算出确定大小。

### 将 `Cons(i32, List)` 改为 `Cons(i32, Box<List>)` 后为什么能编译？
~ 智能指针/box 给递归类型已知大小
A) `Box<List>` 会在编译时展开整个列表并计算总大小
B) `Box<List>` 让 `List` 变成非递归类型
C) `Box<List>` 是指针，大小固定，打破了无限递归的大小计算
D) `Box<List>` 把 `i32` 也移到了堆上
= C
+ 指针的大小不会随其指向的数据量改变，因此编译器能计算出 `List` 的确定大小。

### `let x = 5; let y = Box::new(x);` 后，`assert_eq!(5, *y);` 为什么能工作？
~ 智能指针/box 可像引用一样解引用
A) `*y` 创建了一个指向 `y` 的引用
B) `Box<T>` 实现了 `Deref`，`*y` 可取得内部的 `i32`
C) `Box<T>` 实现了 `Copy`，`*y` 复制出 `Box`
D) `Box<T>` 会把 `i32` 放在栈上，所以 `*y` 是栈值
= B
+ `Box<T>` 实现了 `Deref`，因此可以像引用一样使用解引用运算符访问内部值。

### 自定义 `struct MyBox<T>(T);` 并实现 `new`，但没有为它实现 `Deref`。对 `let y = MyBox::new(5);` 使用 `*y` 会怎样？
~ 智能指针/未实现 deref 不能解引用
A) 编译通过，自动调用 `Clone`
B) 编译通过，但运行时 panic
C) 编译错误，因为 `MyBox<T>` 不能解引用
D) 编译通过，`*y` 得到 `MyBox(5)`
= C
+ 要启用 `*` 运算符对自定义类型的解引用，需要为该类型实现 `Deref` trait。

### 为 `MyBox<T>` 实现 `Deref` 时，`type Target = T;` 和 `fn deref(&self) -> &T { &self.0 }` 分别起什么作用？
~ 智能指针/deref trait 的关联类型与 deref 返回
A) `Target` 指定堆分配大小；`deref` 返回内部值的所有权
B) `Target` 指定解引用后的目标类型；`deref` 返回内部值的引用
C) `Target` 指定 trait 对象类型；`deref` 返回 `Box<T>`
D) `Target` 指定可变借用类型；`deref` 返回 `&mut T`
= B
+ `Deref` 要求 `deref` 借用 `self` 并返回内部数据的引用；`Target` 是解引用后的目标类型。

### 当 `y` 是实现了 `Deref<Target=T>` 的智能指针时，表达式 `*y` 在底层大致被展开为什么？
~ 智能指针/解引用运算符展开
A) `y.deref().clone()`
B) `&y.deref()`
C) `y.drop()`
D) `*(y.deref())`
= D
+ Rust 将 `*y` 替换为先调用 `deref` 再进行普通解引用；`deref` 返回引用是为了不移动内部值。

### 解引用强制转换（deref coercion）主要发生在什么场景？
~ 智能指针/解引用强制转换定义
A) 在两个完全无关的类型之间自动转换所有权时
B) 将实现了 `Deref` 的类型的引用作为参数传给期望另一种引用类型的函数或方法时
C) 在运行时将 `&mut T` 转换为 `&T` 以外的任意类型时
D) 将任意类型转换为 trait 对象时，无需 `Deref`
= B
+ 解引用强制转换是函数或方法传参上的便利，只能工作在实现了 `Deref` 的类型上。

### `hello(&m)` 中 `m: MyBox<String>`，`hello` 参数是 `&str`。解引用强制转换会经过哪条链？
~ 智能指针/解引用强制转换链
A) `&MyBox<String>` → `&String` → `&str`
B) `&MyBox<String>` → `String` → `str`
C) `&MyBox<String>` → `&str` 一步完成，不经过 `&String`
D) `&MyBox<String>` → `Box<str>` → `&str`
= A
+ `MyBox` 的 `Deref` 可把 `&MyBox<String>` 变为 `&String`，`String` 的 `Deref` 再变为 `&str`。

### 关于解引用强制转换与可变性，下列哪条转换是 Rust 不会做的？
~ 智能指针/derefmut 与可变性转换
A) `&T` 到 `&U`（当 `T: Deref<Target=U>`）
B) `&mut T` 到 `&mut U`（当 `T: DerefMut<Target=U>`）
C) `&mut T` 到 `&U`（当 `T: Deref<Target=U>`）
D) `&T` 到 `&mut U`
= D
+ Rust 不会把不可变引用强转为可变引用，因为借用规则无法保证唯一可变借用。

### 示例中 `c` 先创建、`d` 后创建，二者都实现了 `Drop`。`main` 结束时打印顺序如何？
~ 智能指针/drop 自动调用顺序
A) 先打印 `d` 的 drop 信息，再打印 `c` 的 drop 信息
B) 先打印 `c` 的 drop 信息，再打印 `d` 的 drop 信息
C) 只打印 `c` 的 drop 信息
D) 不会自动打印，必须手动调用 `c.drop()`
= A
+ 变量以被创建时相反的顺序被丢弃，所以后创建的 `d` 先被丢弃。

### 为什么不能直接写 `c.drop();` 来提早清理实现了 `Drop` 的值？
~ 智能指针/显式调用 drop 方法
A) `drop` 方法不是 trait 方法，不能通过实例调用
B) 只有 `Box<T>` 才能调用 `drop`
C) Rust 不允许显式调用析构方法，因为之后还会自动 drop，可能导致 double free
D) 调用 `c.drop()` 会返回 `Result`，必须用 `?`
= C
+ Rust 不允许显式调用 `Drop` trait 的 `drop` 方法，否则自动 drop 时可能再次清理同一个值。

### 若要在作用域结束前强制丢弃 `c`，正确做法是什么？
~ 智能指针/std::mem::drop 提早丢弃
A) 调用 `c.drop();`
B) 调用 `Drop::drop(&mut c);`
C) 调用 `std::mem::drop(c);`
D) 将 `c` 放入 `Box` 后不再使用
= C
+ `std::mem::drop` 是标准库提供的函数，可以接收值并强制其提早丢弃；它不同于 `Drop` trait 的 `drop` 方法。

### `Rc<T>` 的主要用途是什么？
~ 智能指针/rc 共享所有权
A) 在运行时检查借用规则并提供内部可变性
B) 将值放在堆上并提供固定大小以支持递归类型
C) 在单线程场景下通过引用计数让一个值拥有多个所有者
D) 在多线程中安全地共享可变数据
= C
+ `Rc<T>` 是引用计数智能指针，用于单线程中让一个值拥有多个所有者。

### 对 `Rc<List>` 调用 `Rc::clone(&a)` 时发生了什么？
~ 智能指针/rc clone 增加引用计数
A) 它复制内部数据但使用更快的内存分配器
B) 它把数据从堆移到栈
C) 它创建 Weak 引用而不是强引用
D) 只增加引用计数，不复制内部数据
= D
+ `Rc::clone` 只增加引用计数，不进行深拷贝，因此开销很小。

### `RefCell<T>` 在违反借用规则时会发生什么？
~ 智能指针/refcell 运行时借用检查
A) 编译错误
B) 运行时 panic
C) 自动转为不可变借用
D) 返回 Err 而不是 panic
= B
+ `RefCell<T>` 把借用规则检查放到运行时；违反规则会 panic，而不是产生编译错误。

### 调用 `RefCell<T>` 的 `borrow_mut` 会返回什么？它如何影响借用计数？
~ 智能指针/refcell borrow 与 borrow_mut
A) 返回 `Ref<T>`，增加不可变借用计数
B) 返回 `&mut T`，不记录计数
C) 返回 `Option<RefMut<T>>`，失败时为 None
D) 返回 `RefMut<T>`，增加可变借用计数
= D
+ `borrow_mut` 返回 `RefMut<T>` 智能指针，并在运行时记录一个活动的可变借用。

### 使用 `Rc<RefCell<i32>>` 的主要效果是什么？
~ 智能指针/rc 与 refcell 结合
A) 多个所有者只能不可变读取同一个值
B) 在编译时检查借用规则并避免运行时开销
C) 允许跨线程安全共享可变数据
D) 多个所有者可以共享并修改同一个值
= D
+ `Rc<T>` 提供多个所有者，`RefCell<T>` 提供内部可变性，因此可在单线程中共享并修改同一个值。

### `Rc::downgrade` 和 `Weak<T>::upgrade` 分别做什么？
~ 智能指针/weak 避免引用循环
A) downgrade 创建弱引用并增加 weak_count；upgrade 返回 `Option<Rc<T>>`，值还在则 `Some`
B) downgrade 创建强引用并增加 strong_count；upgrade 强制转换为 `&T`
C) downgrade 减少 strong_count；upgrade 返回 `Rc<T>` 或 panic
D) downgrade 深拷贝 `Rc<T>`；upgrade 返回 `Weak<T>`
= A
+ 弱引用不拥有数据，不会造成引用循环；`upgrade` 用 `Option<Rc<T>>` 表示被引用的值是否仍然存在。

## 无畏并发

### 本节中，程序内部「多个同时运行的独立部分」被称为什么？
~ 无畏并发/进程与线程
A) 线程
B) 进程
C) 协程
D) 任务
= A
+ 本节指出，运行程序中独立部分的功能被称为线程（threads）；进程则是操作系统管理的、已执行程序代码所在的地方。

### 由编程语言调用操作系统 API 创建线程，一个 OS 线程对应一个语言线程，这种线程模型被称为什么？
~ 无畏并发/1:1 线程模型
A) 1:1 模型
B) M:N 模型
C) 绿色线程模型
D) N:1 模型
= A
+ 1:1 模型指一个 OS 线程对应一个语言线程；绿色线程则是 M:N 模型。

### 关于绿色线程，本节的说法是？
~ 无畏并发/绿色线程
A) 由编程语言自身实现的线程，在不同数量的 OS 线程上运行，即 M:N 模型
B) 由操作系统直接创建，且一个绿色线程必须对应一个 OS 线程
C) 必须与 OS 线程数量相等才能运行
D) 是 Rust 标准库默认采用的线程实现
= A
+ 语言提供的线程称为绿色线程，M 个绿色线程对应 N 个 OS 线程，M 与 N 不必相同。

### 为什么 Rust 标准库只提供 1:1 线程模型的实现？
~ 无畏并发/运行时与线程模型的取舍
A) M:N 模型需要更大的语言运行时来管理绿色线程，而 Rust 需要做到几乎没有运行时
B) 因为 1:1 模型永远不会产生竞争状态
C) 因为操作系统禁止语言实现绿色线程
D) 因为 M:N 模型无法保证内存安全
= A
+ 绿色线程的 M:N 模型需要更大的运行时来管理线程；Rust 追求几乎没有运行时并保持可调用 C 的高性能。

### 使用 thread::spawn 创建新线程时，需要向它传递什么？
~ 无畏并发/spawn 创建线程
A) 一个闭包，其中包含希望在新线程运行的代码
B) 一个 JoinHandle
C) 一个通道的发送端
D) 一个不捕获任何环境的函数指针
= A
+ thread::spawn 接收一个闭包，闭包中包含希望在新线程运行的代码，并返回 JoinHandle。

### thread::spawn 的返回值是什么类型？对其调用 join 会产生什么效果？
~ 无畏并发/join 等待线程结束
A) JoinHandle；join 会阻塞当前线程直到其代表的线程结束
B) JoinHandle；join 会让新建线程立刻结束
C) Receiver；join 会从通道接收一个值
D) MutexGuard；join 会释放互斥器的锁
= A
+ thread::spawn 返回拥有所有权的 JoinHandle，调用 join 会阻塞当前线程直到该线程结束。

### 在传给 thread::spawn 的闭包前加上 move 关键字的作用是？
~ 无畏并发/move 闭包与线程
A) 强制闭包获取其使用的环境值的所有权，而不是借用
B) 让闭包在新线程中运行得更快
C) 让闭包能把返回值交还给主线程
D) 声明该闭包只能被调用一次
= A
+ move 关键字覆盖 Rust 默认的保守借用，强制闭包取得它所用环境值的所有权。

### 给示例中的线程闭包加上 move，把 v 移入闭包后，主线程再调用 drop(v) 会怎样？
~ 无畏并发/move 后的所有权规则
A) 编译错误：使用了已移动的值 v
B) 编译通过，v 被立即丢弃
C) 编译通过，但运行时 panic
D) 编译通过，v 会被复制一份再丢弃
= A
+ move 把 v 移动进闭包环境，之后主线程再使用 v 就违反了所有权规则，编译器报 use of moved value。

### mpsc 这个缩写代表什么？
~ 无畏并发/mpsc 的含义
A) multiple producer, single consumer
B) multi process, single channel
C) multiple sender, shared consumer
D) message passing, single channel
= A
+ mpsc 是「多个生产者，单个消费者」的缩写：一个通道可以有多个发送端，但只能有一个接收端。

### mpsc::channel() 返回什么？
~ 无畏并发/创建通道
A) 一个元组，第一个元素是发送端，第二个是接收端
B) 一个元组，第一个元素是接收端，第二个是发送端
C) 一个单独的发送端，接收端需另行调用 recv 创建
D) 一个自身实现了 Iterator 的通道对象
= A
+ mpsc::channel 返回 (tx, rx)：第一个元素是发送端，第二个元素是接收端。

### 通道发送端的 send 方法为什么返回 Result？
~ 无畏并发/send 的返回值
A) 如果接收端已被丢弃，就没有发送目标，发送操作会返回错误
B) 因为发送的值必须是 Copy 的
C) 因为 send 一定会阻塞直到接收端准备好
D) 因为通道可能因类型不匹配而失败
= A
+ send 返回 Result<T, E>；接收端被丢弃时发送会失败返回错误。

### 关于通道接收端的 recv 和 try_recv，本节的说法是？
~ 无畏并发/recv 与 try_recv
A) recv 会阻塞直到收到值；try_recv 不会阻塞，立刻返回 Ok 或 Err
B) recv 不会阻塞；try_recv 会阻塞
C) 两者都会阻塞，只是返回类型不同
D) recv 返回 Option，try_recv 返回 Result
= A
+ recv 阻塞等待值；try_recv 立即返回，Ok 含可用消息、Err 表示当前没有消息。

### 为什么在 tx.send(val).unwrap() 之后再打印 val 无法通过编译？
~ 无畏并发/通道与所有权转移
A) send 获取参数的所有权并移动该值，之后不能再使用 val
B) 因为 val 没有实现 Display trait
C) 因为 println! 宏不能在线程中使用
D) 因为通道要求发送的值必须实现 Copy
= A
+ send 获取其参数的所有权并移动给接收者，发送后再使用该值会报 use of moved value。

### 在 for received in rx 循环中，循环什么时候结束？
~ 无畏并发/接收端作为迭代器
A) 当通道被关闭（发送端被丢弃）时，迭代器也随之结束
B) 循环不会结束，会一直执行下去
C) 在所有发送端都被克隆之后结束
D) 在接收到第一条消息之后就结束
= A
+ 把 rx 当作迭代器遍历，每次收到一个值；当通道被关闭时迭代器结束。

### 如何让多个线程向同一个接收者发送消息？
~ 无畏并发/克隆发送者创建多个生产者
A) 在创建线程前克隆发送端 tx，把克隆和原始发送端分别交给不同线程
B) 克隆接收端 rx 后分发给每个线程
C) 让每个线程各自调用 mpsc::channel 创建自己的通道
D) 把 tx 用 Rc 包装后在多个线程间共享
= A
+ mpsc 支持多个生产者：克隆 tx 得到多个发送端，各自 move 进不同线程，接收端仍只有一个。

### Mutex<T> 的 lock 方法返回什么？锁是如何被释放的？
~ 无畏并发/MutexGuard 自动释放锁
A) 返回 MutexGuard 智能指针，其 Drop 实现会在离开作用域时自动释放锁
B) 返回 &mut T，必须手动调用 unlock 释放
C) 返回内部值的拷贝，锁在返回时立即释放
D) 返回一个 bool，表示是否成功获得锁
= A
+ lock 返回 MutexGuard，它实现 Deref 指向内部数据，并在离开作用域时通过 Drop 自动解锁。

### 为什么多个线程共享 Mutex 时要用 Arc<T> 而不是 Rc<T>？
~ 无畏并发/Arc 与 Rc
A) Rc<T> 不是 Send 的：它改变引用计数时没有使用并发原语，不能安全地跨线程
B) 因为 Rc<T> 不能被克隆
C) 因为 Rc<T> 只能存放实现了 Copy 的类型
D) 因为 Arc<T> 额外提供了可变借用能力
= A
+ Rc<T> 的引用计数非原子，克隆并转移到其他线程可能同时更新计数；Arc<T> 是原子引用计数，可安全用于并发。

### 本节把 Mutex<T> 与 Arc<T> 分别类比为第 15 章中的哪一对类型？
~ 无畏并发/Mutex 的内部可变性类比
A) RefCell<T> 与 Rc<T>
B) Cell<T> 与 Box<T>
C) RefCell<T> 与 Box<T>
D) Rc<T> 与 Weak<T>
= A
+ Mutex<T> 提供内部可变性，如同 RefCell<T>；Arc<T> 提供多所有者共享，如同 Rc<T>。

### Send 标记 trait 表明什么？
~ 无畏并发/Send trait
A) 该类型的所有权可以在线程间传递
B) 该类型的引用可以被多个线程安全共享
C) 该类型的数据一定分配在堆上
D) 该类型会在运行时检查借用规则
= A
+ Send 表明类型的所有权可以在线程间传递；几乎所有 Rust 类型都是 Send，例外如 Rc<T> 和裸指针。

### Sync 标记 trait 表明什么？
~ 无畏并发/Sync trait
A) 对于任意类型 T，如果 &T 是 Send 的，那么 T 就是 Sync 的，其引用可以安全地发送到另一个线程
B) T 的所有权可以在线程间转移
C) T 的克隆操作是原子的
D) T 可以在单线程中获得内部可变性
= A
+ Sync 表明可安全地在多个线程中拥有其值的引用；RefCell<T>、Cell<T> 和 Rc<T> 都不是 Sync 的，而 Mutex<T> 是。

## Rust 的面向对象编程特性

### 根据 The Gang of Four 在《设计模式》中的定义，一个对象包含什么？
~ 面向对象编程/对象定义
A) 数据和操作这些数据的过程（方法）
B) 仅数据，不包含方法
C) 仅方法，不包含数据
D) 类型参数和 trait bound
= A
+ 文中引用该定义：对象包含数据和操作这些数据的过程，这些过程通常被称为方法或操作。

### 在 Rust 中，模块、类型、函数和方法默认的可见性是什么？
~ 面向对象编程/默认私有
A) 公有，除非用 pub 显式改为私有
B) 私有，除非用 pub 显式暴露
C) 受保护，只能子类访问
D) 包内可见，跨包不可见
= B
+ 本节说可以使用 pub 关键字来决定模块、类型、函数和方法是公有的，而默认情况下其他一切都是私有的。

### 在 AveragedCollection 例子中，封装使得将来可以怎样改变内部实现而不影响使用代码？
~ 面向对象编程/封装与重构
A) 把 list 字段改为 pub，让外部直接操作
B) 删除 average 字段并让外部每次自行计算
C) 用 HashSet<i32> 代替 Vec<i32> 作为 list 字段类型，只要公有方法签名不变
D) 把结构体本身改为私有，使外部无法使用
= C
+ 文中说因为封装好了实现细节，将来可以轻松改变内部数据结构，例如用 HashSet<i32> 代替 Vec<i32>，只要公有函数签名不变，使用代码无需改变。

### 关于 Rust 的继承，下列哪项符合本节内容？
~ 面向对象编程/结构体继承
A) Rust 允许结构体继承父结构体的成员和方法
B) Rust 只允许单继承，不允许 trait 实现
C) Rust 无法定义一个结构体继承父结构体的成员和方法
D) Rust 通过 impl 块实现结构体继承
= C
+ 本节明确说无法定义一个结构体继承父结构体的成员和方法，因此若必须有继承才算面向对象，Rust 就不是面向对象的。

### 本节说 Rust 可以用什么机制替代继承来实现代码重用？
~ 面向对象编程/默认 trait 方法
A) 默认 trait 方法实现
B) 结构体字段的 pub 修饰
C) 动态分发
D) 对象安全
= A
+ 文中说选择继承的原因之一是为了重用代码，而 Rust 可以使用默认 trait 方法实现来共享，任何实现了该 trait 的类型都可以使用默认方法。

### 本节指出，Rust 通过什么对不同的可能类型进行抽象，并约束这些类型必须提供的内容？
~ 面向对象编程/多态与泛型
A) 继承和子类
B) 泛型和 trait bounds
C) 枚举和 match
D) 裸指针和 unsafe
= B
+ 文中说 Rust 通过泛型来对不同的可能类型进行抽象，并通过 trait bounds 对这些类型所必须提供的内容施加约束。

### 本节中，trait 对象指向什么？
~ 面向对象编程/trait 对象定义
A) 一个包含所有实现了该 trait 的类型的枚举
B) 一个在编译时单态化的泛型参数
C) 一个实现了指定 trait 的类型的实例，以及一个用于在运行时查找该类型 trait 方法的表
D) 一个只能存放具体类型 Button 的 Box
= C
+ 文中定义 trait 对象：指向一个实现了指定 trait 的类型的实例，以及一个用于在运行时查找该类型 trait 方法的表。

### 在 Screen 结构体中，字段 components: Vec<Box<dyn Draw>> 表示什么？
~ 面向对象编程/trait 对象语法
A) 一个只能存放 Draw trait 本身的 vector
B) 一个存放 trait 对象的 vector，每个元素是 Box 中任何实现了 Draw 的类型的替身
C) 一个存放泛型 T 的 vector，T 必须在编译时确定
D) 一个存放字符串的 vector，因为 dyn 会转换为 String
= B
+ 本节说 Box<dyn Draw> 是一个 trait 对象，它是 Box 中任何实现了 Draw trait 的类型的替身；Screen 用它存放 trait 对象。

### 与使用 trait 对象的 Screen 相比，示例 17-6 中使用泛型和 trait bound 的 Screen<T: Draw> 有什么限制？
~ 面向对象编程/泛型与 trait 对象对比
A) 它不能调用 draw 方法
B) 它必须使用动态分发
C) 它的组件列表必须全是同一具体类型，比如全是 Button 或全是 TextField
D) 它不能存放任何实现了 Draw 的类型
= C
+ 文中说这限制了 Screen 实例必须拥有一个全是 Button 类型或者全是 TextField 类型的组件列表；trait 对象才允许混合多种具体类型。

### 本节说 Rust 使用 trait 对象和类型系统进行类似鸭子类型操作的优势是什么？
~ 面向对象编程/鸭子类型
A) 无需在运行时检查值是否实现特定方法，若值没有实现所需 trait 则代码不会编译
B) 可以在运行时向 trait 对象动态添加新方法
C) 可以绕过所有权规则直接共享数据
D) 可以自动为所有类型实现 Draw trait
= A
+ 文中说优势是无需在运行时检查一个值是否实现了特定方法或担心调用时因为值没有实现方法而产生错误；如果值没有实现 trait 对象所需的 trait 则 Rust 不会编译这些代码。

### 为什么使用 trait 对象时 Rust 必须使用动态分发？
~ 面向对象编程/动态分发
A) 因为 trait 对象总是比泛型慢，编译器故意选择慢路径
B) 因为编译器无法知晓所有可能用于 trait 对象代码的类型，所以不知道应该调用哪个类型的哪个方法实现
C) 因为 trait 对象不能有方法
D) 因为 trait 对象在编译时会被单态化
= B
+ 文中解释：编译器无法知晓所有可能用于 trait 对象代码的类型，所以它也不知道应该调用哪个类型的哪个方法实现；为此 Rust 在运行时使用 trait 对象中的指针来知晓需要调用哪个方法。

### 对泛型使用 trait bound 时，编译器进行单态化处理，这产生哪种分发？
~ 面向对象编程/静态分发与单态化
A) 动态分发
B) 静态分发
C) 双分发
D) 无分发
= B
+ 文中说单态化所产生的代码进行静态分发；静态分发发生于编译器在编译时就知晓调用了什么方法的时候。

### 本节列出实践中的两条对象安全规则，下列哪项是其中之一？
~ 面向对象编程/对象安全规则
A) trait 必须继承自 Clone
B) 方法必须有默认实现
C) 方法没有任何泛型类型参数
D) 方法必须使用 &mut self 作为第一个参数
= C
+ 文中说如果一个 trait 中所有的方法都有如下属性则 trait 是对象安全的：返回值类型不为 Self；方法没有任何泛型类型参数。

### 为什么 Box<dyn Clone> 不能作为 trait 对象使用？
~ 面向对象编程/Clone 与对象安全
A) 因为 Clone 没有方法
B) 因为 Clone 的 clone 方法不接受 self 参数
C) 因为 Clone 的 clone 方法返回 Self，而 trait 对象不知道具体类型
D) 因为 Clone 的 clone 方法有泛型类型参数
= C
+ 文中说 Clone 的 clone 方法签名返回 Self，需要知道什么类型会代替 Self；trait 对象忘却了真正类型，所以 Clone 不是对象安全的。

### 在 Rust 中实现状态模式时，本节说用什么代替对象和继承？
~ 面向对象编程/状态模式实现方式
A) 结构体和 trait
B) 枚举和 match
C) 泛型和生命周期
D) 宏和模块
= A
+ 文中说状态对象共享功能：当然，在 Rust 中使用结构体和 trait 而不是对象和继承。

### 在 Post 的状态模式实现中，为什么 state 字段使用 Option<Box<dyn State>>，并在 request_review 中调用 take？
~ 面向对象编程/状态模式 Option take
A) 为了在运行时检查状态是否存在并决定是否 panic
B) 为了获取老状态的所有权并临时留下 None，因为 Rust 不允许结构体实例中存在值为空的字段
C) 为了允许 state 同时存放多个状态
D) 为了自动为 State trait 增加默认方法
= B
+ 文中说需要临时设置为 None 来获取 state 值，即老状态的所有权；Option 的来历是 Rust 不允许结构体实例中存在值为空的字段。

### 在 State trait 中，fn request_review(self: Box<Self>) -> Box<dyn State>; 的方法接收者 self: Box<Self> 意味着什么？
~ 面向对象编程/Box<Self> 接收者
A) 该方法只可在持有这个类型的 Box 上被调用，并获取 Box<Self> 的所有权使老状态无效化
B) 该方法只能通过共享引用 &self 调用
C) 该方法返回具体的 Self 类型，因此不是对象安全的
D) 该方法不能用于 trait 对象，只能用于枚举
= A
+ 文中说这个语法意味着该方法只可在持有这个类型的 Box 上被调用；获取了 Box<Self> 的所有权使老状态无效化，以便 Post 的状态值可转换为新状态。

### 在将状态编码为类型的版本中，为什么草案博文不可能意外显示内容？
~ 面向对象编程/状态编码为类型
A) DraftPost 的 content 方法返回空字符串
B) DraftPost 没有定义 content 方法，尝试获取内容会产生编译错误
C) Post::new 返回 Post 且 content 字段被设为 pub
D) 运行时检查状态并在不是 Published 时 panic
= B
+ 文中说 DraftPost 并没有定义 content 方法，所以尝试读取其内容会导致编译错误；因此不可能在生产环境意外显示草案博文的内容。

### 在类型编码状态转移的版本中，DraftPost::request_review(self) 和 PendingReviewPost::approve(self) 获取 self 的所有权有什么效果？
~ 面向对象编程/状态转移消费 self
A) 消费原实例并转换为新类型，调用后不会遗留原状态实例
B) 允许原地修改原结构体的 state 字段
C) 允许通过 trait 对象动态分发
D) 使方法可以返回 Self 而不违反对象安全
= A
+ 文中说这两个方法获取 self 的所有权，因此会消费 DraftPost 和 PendingReviewPost 实例，并分别转换为 PendingReviewPost 和发布的 Post；这样调用后不会遗留原实例。

### 本节指出状态模式的一个缺点是什么？
~ 面向对象编程/状态模式缺点
A) 状态实现了状态之间的转换，一些状态会相互联系，增加新状态可能需要修改现有状态的代码
B) 状态模式无法在 Rust 中实现
C) 状态模式必须使用继承才能工作
D) 状态模式不能在运行时改变行为
= A
+ 文中说状态模式的一个缺点是因为状态实现了状态之间的转换，一些状态会相互联系；如果在 PendingReview 和 Published 之间增加另一个状态，就不得不修改 PendingReview 中的代码。

## 模式和匹配

### 关于 `match` 表达式的分支模式，下列说法正确的是？
~ 模式和匹配/match 的穷尽性
A) `match` 只要有一个分支能匹配即可编译，未覆盖的值会在运行时 panic
B) `match` 允许省略分支，编译器会自动补一个 panic 分支
C) `match` 的所有分支模式必须覆盖被匹配值的每一种可能，否则不能编译
D) `match` 是否穷尽只由最后一个分支是否为 `_` 决定
= C
+ `match` 表达式必须是穷尽的：所有可能的值都必须被考虑到，否则编译失败。

### 模式 `_` 的特点是？
~ 模式和匹配/下划线通配模式
A) 匹配任何值，并把它绑定到名为 `_` 的变量
B) 匹配任何值，但不绑定任何变量
C) 只能匹配 `None`
D) 只能用于 `match` 的最后一个分支
= B
+ `_` 可以匹配所有情况，但它从不绑定任何变量。

### 关于 `_x` 与单独 `_` 的区别，下列说法正确的是？
~ 模式和匹配/下划线前缀变量仍绑定值
A) 两者完全等价，都只是抑制未使用变量警告
B) `_` 会绑定值，`_x` 不会绑定值
C) `_x` 仍会把值绑定到变量上，因此可能取得值的所有权；`_` 则完全不绑定
D) `_x` 会抑制警告但不绑定值，`_` 会绑定值
= C
+ 示例中 `if let Some(_s) = s` 会把 s 移动进 `_s`，而 `if let Some(_) = s` 不绑定、不移动，之后仍可使用 s。

### 相比 `match`，`if let` 的一个缺点是什么？
~ 模式和匹配/if let 不检查穷尽性
A) `if let` 只能匹配 `Option` 类型的值
B) `if let` 的穷尽性不会被编译器检查，漏掉情况也不会警告
C) `if let` 不能带 `else` 分支
D) `if let` 的模式必须是不可反驳的
= B
+ `if let` 表达式的穷尽性没有为编译器所检查，遗漏情况不会产生警告。

### 在 `if let Ok(age) = age { ... }` 中，关于模式引入的 `age` 说法正确的是？
~ 模式和匹配/if let 引入的覆盖变量作用域
A) `age` 会覆盖外层的 `age` 直到函数结束
B) `age` 必须与外层变量类型不同，否则报错
C) 不能在 `if let` 的模式中创建与外层同名的变量
D) 模式引入的 `age` 是覆盖变量，只从代码块开始的新作用域起有效
= D
+ 所以不能把条件写成 `if let Ok(age) = age && age > 30`，被覆盖的 `age` 直到大括号内才有效。

### `while let Some(top) = stack.pop() { ... }` 的行为是？
~ 模式和匹配/while let 条件循环
A) 循环体至少执行一次，然后才检查模式是否匹配
B) 只要 `pop()` 返回 `Some` 就继续循环，返回 `None` 时停止
C) `pop()` 返回 `None` 时会 panic
D) 只有当 `pop()` 返回 `None` 时才进入循环体
= B
+ `while let` 允许只要模式匹配就一直循环，`pop` 返回 `None` 时循环停止。

### 在 `for (index, value) in v.iter().enumerate() { ... }` 中，`(index, value)` 是什么？
~ 模式和匹配/for 循环中的模式
A) 一个解构元组的模式，把 enumerate 产生的 (索引, 值) 元组拆开
B) 一个函数调用，等价于调用 `index(value)`
C) 一个类型标注，声明 index 和 value 的类型
D) 一个元组字面量，用来构造新的元组
= A
+ `for` 关键字后直接跟随的就是模式，这里用元组模式解构 enumerate 产生的元组。

### `let (x, y) = (1, 2, 3);` 会发生什么？
~ 模式和匹配/let 元组解构数量必须匹配
A) 编译通过，第三个值被自动丢弃
B) 编译通过，`y` 会得到 `2` 和 `3` 组成的元组
C) 编译时类型错误，模式中元素数量与元组中元素数量不一致
D) 运行时 panic
= C
+ 模式中元素数量与元组元素数量不一致会导致类型不匹配并编译失败。

### `fn print_coordinates(&(x, y): &(i32, i32))` 的参数部分说明了什么？
~ 模式和匹配/函数参数中的模式
A) 函数参数不能是模式，这段代码不能编译
B) 函数参数本身也是模式，可以解构元组和引用
C) 参数中的 `&` 表示按值获取所有权
D) `(x, y)` 是返回类型的一部分
= B
+ 值 `&(3, 5)` 会匹配模式 `&(x, y)`，得到 x 为 3、y 为 5。

### 关于可反驳（refutable）和不可反驳（irrefutable）模式，下列说法正确的是？
~ 模式和匹配/可反驳与不可反驳模式
A) 不可反驳模式能匹配任何传入的值因此不会失败；可反驳模式对某些值会匹配失败
B) 不可反驳模式指编译期无法验证的模式
C) 可反驳模式总能匹配任何值
D) `let x = 5;` 中的 `x` 是可反驳模式
= A
+ `x` 能匹配任何值所以不可反驳；`Some(x)` 遇到 `None` 会失败所以可反驳。

### `let Some(x) = some_option_value;` 为什么不能编译？
~ 模式和匹配/let 只接受不可反驳模式
A) `Some` 不是合法的模式名
B) `let` 语句不支持解构 `Option`
C) 因为 `some_option_value` 未声明为可变
D) `let` 语句只接受不可反驳模式，而 `Some(x)` 没有覆盖 `None` 的情况
= D
+ 编译器会报告 refutable pattern in local binding：`None` not covered。

### 把不可反驳模式用在 `if let` 上，例如 `if let x = 5 { }`，会怎样？
~ 模式和匹配/if let 使用不可反驳模式
A) 编译错误，`if let` 禁止任何变量模式
B) 编译通过，但编译器会发出「irrefutable if-let pattern」警告
C) 编译通过且没有任何警告，属于推荐写法
D) 运行时 panic
= B
+ Rust 会警告将不可反驳模式用于 `if let` 是没有意义的，这种写法可用更简单的 `let` 替代。

### 示例中先 `let y = 10;`，随后在 `match x { ... Some(y) => ... }` 分支里的 `y` 指的是？
~ 模式和匹配/match 中命名变量覆盖外层变量
A) 外层的 `y`，即 10
B) 分支模式新引入的变量，覆盖了外层的 `y`，绑定 `Some` 内部的值
C) 编译错误，不允许与外层变量同名
D) 一个常量模式，要求值必须等于 10
= B
+ `match` 会开始新作用域，模式中的 `y` 是新变量，绑定到 `Some` 内部的值（这里是 5）。

### 在 `match` 分支中使用 `1 | 2 => ...` 表示？
~ 模式和匹配/多模式或语法
A) 要求被匹配的值同时等于 1 和 2
B) 按位或运算后与值比较
C) 该分支匹配 `1` 或 `2` 中任意一个值
D) 依次执行两个分支的代码
= C
+ `|` 语法代表「或」，值匹配其中任一个模式就执行该分支。

### 关于 `..=` 范围模式，下列说法正确的是？
~ 模式和匹配/范围模式 ..= 的类型限制
A) 它可以用于任意类型，包括 `String` 和自定义结构体
B) 它匹配闭区间内的值，且只能用于数字或 `char` 值
C) 它匹配半开区间，不包含右端点
D) 它要求范围必须为空，否则编译错误
= B
+ 编译器要在编译时检查范围不为空，而只有数字和 char 值能判断范围是否为空。

### `let Point { x, y } = p;` 与 `let Point { x: a, y: b } = p;` 的关系是？
~ 模式和匹配/解构结构体与字段简写
A) 前者是字段简写，创建名为 `x`、`y` 的变量；后者可为字段指定不同的变量名
B) 两者完全等价，都创建名为 `a`、`b` 的变量
C) 前者不合法，结构体模式必须写明字段到变量的映射
D) 前者只在 `match` 中合法，`let` 中不合法
= A
+ 模式中的变量名不必与字段名一致，字段简写只是在同名时省略重复书写。

### 解构枚举时，模式必须怎样写？
~ 模式和匹配/解构枚举成员的形式
A) 无论成员是否有数据，一律写成 `成员名(..)`
B) 只能解构类元组成员，类结构体成员无法解构
C) 必须为每个成员写 `_` 忽略其内部数据
D) 必须对应成员定义的数据形式：无数据成员直接写成员名，类结构体成员用大括号，类元组成员用括号且变量数匹配
= D
+ 例如 `Message::Quit`、`Message::Move { x, y }`、`Message::Write(text)` 分别对应三种成员形式。

### 关于模式中的 `..`，下列说法正确的是？
~ 模式和匹配/用 .. 忽略剩余值
A) 它忽略模式中剩余未显式匹配的部分，但在同一个元组或元组结构体模式中只能出现一次
B) 它等价于多个 `_`，可在同一元组模式中出现任意多次
C) 它只能用在结构体模式中，不能用于元组
D) 它必须放在模式的最前面
= A
+ `(.., second, ..)` 会因有歧义而报错：`..` can only be used once per tuple or tuple struct pattern。

### 在 `4 | 5 | 6 if y => ...` 中，匹配守卫 `if y` 作用于？
~ 模式和匹配/匹配守卫与或模式的优先级
A) 只有最后的 `6`
B) 只有最先的 `4`
C) 不作用于任何模式，会被编译器忽略
D) 整个 `4 | 5 | 6` 模式，值匹配任一项后还需 `y` 为真
= D
+ 优先级等价于 `(4 | 5 | 6) if y`，而不是 `4 | 5 | (6 if y)`。

### `Message::Hello { id: id_variable @ 3..=7 }` 中 `@` 的作用是？
~ 模式和匹配/@ 绑定
A) 把 `id` 字段重命名为 `id_variable`
B) 在测试值是否落在 `3..=7` 范围的同时，把该值绑定到 `id_variable`
C) 表示 `id_variable` 是可变引用
D) 表示优先级高于范围模式，先绑定再无条件匹配
= B
+ `@` 允许在创建存放值的变量的同时测试其值是否匹配模式。

## 高级特征

### 本节列出的五类只能在 unsafe 中进行的操作（“不安全的超能力”）不包括以下哪项？
~ unsafe rust/五个超能力
A) 解引用裸指针
B) 调用不安全的函数或方法
C) 关闭借用检查器
D) 访问或修改可变静态变量
= C
+ unsafe 不会关闭借用检查器或禁用其他安全检查；关闭借用检查器不在五类操作中。

### 关于裸指针的创建和解引用，下列哪项符合本节说法？
~ unsafe rust/裸指针创建与解引用
A) 可以在安全代码中创建裸指针，但解引用裸指针需要 unsafe 块
B) 创建裸指针和解引用裸指针都只能在 unsafe 块中完成
C) 裸指针会在离开作用域时自动清理其指向的数据
D) 裸指针一定是有效的，因为它们由引用强制转换而来
= A
+ 本节明确可在安全代码中创建裸指针，只是不能在不安全块之外解引用；裸指针不保证有效且无自动清理。

### 关于用 unsafe 实现的 `split_at_mut`，下列哪项正确？
~ unsafe rust/安全抽象
A) 函数内部使用 unsafe 代码，但函数本身是安全函数，可在安全 Rust 中调用
B) 因为内部使用 unsafe，所以函数必须声明为 unsafe 才能调用
C) unsafe 块使函数跳过了 `mid <= len` 的断言
D) 该实现返回的两个可变 slice 仍被借用检查器视为同一借用而无法编译
= A
+ 本节把 `split_at_mut` 作为安全抽象的例子：内部 unsafe，外部安全；断言仍保留。

### 通过 `extern "C"` 块声明并调用 C 函数时，下列哪项正确？
~ unsafe rust/extern 函数
A) `extern` 块中声明的函数在 Rust 代码中总是不安全的，调用需要 unsafe 块
B) 这类函数可以像普通安全函数一样直接调用，不需要 unsafe
C) `"C"` 指定的是 Rust crate 名称
D) extern 块只能声明 Rust 标准库函数
= A
+ 本节说明 extern 块中声明的函数在 Rust 代码中总是不安全的，且 C 是应用二进制接口 ABI。

### 关于可变静态变量，下列哪项正确？
~ unsafe rust/可变静态变量
A) 访问和修改可变静态变量都是不安全的
B) 不可变静态变量的访问也需要 unsafe 块
C) 编译器会禁止多个线程访问可变静态变量
D) 静态变量与常量完全相同，使用时都会复制数据
= A
+ 本节：访问不可变静态变量安全；访问/修改可变静态变量不安全。编译器不禁止多线程访问，而是认为不安全。静态变量有固定地址，常量可复制。

### 定义并实现一个不安全 trait 时，下列哪种写法是必要的？
~ unsafe rust/不安全 trait
A) `unsafe trait Foo { ... }` 且实现用 `unsafe impl Foo for T { ... }`
B) 只需在实现时写 `unsafe impl`，trait 定义前不能加 `unsafe`
C) 只需在 trait 定义前加 `unsafe`，实现时照常 `impl`
D) 不安全 trait 完全不需要 unsafe 关键字
= A
+ 不安全 trait 在 trait 前加 unsafe，实现也必须 unsafe impl。

### 本节说访问 `union` 字段需要 unsafe，主要原因是什么？
~ unsafe rust/联合体字段
A) Rust 无法保证当前存储在联合体实例中数据的类型
B) 联合体字段永远是空指针
C) 联合体只能用于 Rust 内部，不能与 C 交互
D) 联合体字段会自动实现 Drop，需要手动清理
= A
+ 联合体同时只能使用一个声明字段，Rust 无法保证当前存储的数据类型，因此访问字段不安全。

### 与在 trait 中使用泛型参数相比，关联类型的关键区别是什么？
~ 高级 trait/关联类型
A) 使用关联类型时，一个类型对同一 trait 只能有一个实现，调用时无需标注具体类型
B) 使用关联类型时，一个类型可以对同一 trait 有多个实现，每次需标注类型
C) 关联类型只能用于结构体，不能用于 trait 方法签名
D) 关联类型必须显式声明为 unsafe
= A
+ 本节以 Iterator 为例说明：关联类型使一个类型只能选择一次 Item，无需每次标注；泛型参数则可有多个实现并需标注。

### `Add` trait 定义中的 `RHS=Self` 属于什么语法，其作用是什么？
~ 高级 trait/默认泛型参数
A) 默认类型参数；实现 `Add` 时不指定 `RHS`，则 `RHS` 为 `Self`
B) 关联类型约束；要求 `RHS` 必须是 `Self` 的别名
C) 生命周期参数；规定右操作数至少活到 `self` 结束
D) 运算符优先级标记；用于选择 `+` 的结合性
= A
+ 尖括号中的 `RHS=Self` 是默认类型参数；未指定时 RHS 为 Self。

### 当同名关联函数没有 `self` 参数，Rust 无法判断调用哪个实现时，应使用哪种语法消歧义？
~ 高级 trait/完全限定语法
A) `<Dog as Animal>::baby_name()`
B) `Dog::baby_name()`
C) `Animal::baby_name()`
D) `Dog.Animal::baby_name()`
= A
+ 完全限定语法 `<Type as Trait>::function` 指定把 Dog 当作 Animal 对待。

### 要使 `OutlinePrint` trait 的实现能使用 `Display` 的 `to_string`，应如何声明 `OutlinePrint`？
~ 高级 trait/父 trait
A) `trait OutlinePrint: Display { ... }`
B) `trait OutlinePrint<T: Display> { ... }`
C) `trait OutlinePrint where Display { ... }`
D) `trait OutlinePrint -> Display { ... }`
= A
+ 在 trait 名后加 `: Display` 指定父 trait，类似 trait bound。

### 使用 newtype 模式绕过孤儿规则的核心做法是什么？
~ newtype/孤儿规则
A) 在元组结构体中封装外部类型，使封装类型成为本地类型，再在封装类型上实现外部 trait
B) 直接为外部类型实现外部 trait，并在 impl 前加 unsafe
C) 用 `type` 关键字给外部类型起别名，然后为别名实现外部 trait
D) 将外部 trait 复制到本地 crate 中再实现
= A
+ newtype 是元组结构体封装，封装类型本地，可对其实现外部 trait；别名不是新类型，不能绕过孤儿规则。

### `type Kilometers = i32;` 中 `Kilometers` 的性质是什么？
~ 类型别名/同义词
A) 它是 `i32` 的同义词，不是新的单独类型，可与 `i32` 值相加或互传
B) 它是 `i32` 的 newtype，能提供类型检查防止混淆
C) 它会在运行时创建一个新的包装对象
D) 它只能用于函数返回类型，不能用于变量标注
= A
+ 类型别名是同义词，与 i32 同一类型，不能获得 newtype 的类型检查好处。

### 函数返回类型 `!` 表示什么？
~ never type/发散函数
A) 函数从不返回，是发散函数
B) 函数返回空元组
C) 函数返回任意类型的一个值
D) 函数必须 panic，不能以无限 `loop` 结束
= A
+ `!` 是 never type，没有值，用于从不返回的函数；无限 loop 也可产生 `!`。

### 对于泛型函数 `fn generic<T>(t: T)`，Rust 隐式加上的约束是什么？
~ 动态大小类型/sized trait
A) 隐式为 `T` 加上 `Sized` bound，即默认只能用于编译时已知大小的类型
B) 隐式为 `T` 加上 `?Sized` bound，允许任何动态大小类型按值传递
C) 隐式要求 `T` 实现 `Copy`
D) 隐式要求 `T` 是引用类型
= A
+ 本节：Rust 隐式为每个泛型函数增加 Sized bound；要放宽用 `?Sized` 且通常需把参数置于指针后。

### 关于函数指针 `fn`，下列哪项正确？
~ 函数指针/fn 类型
A) 它是一个类型，不是闭包 trait；函数指针实现了 `Fn`、`FnMut` 和 `FnOnce`
B) 它只是一个 trait，不能直接作为参数类型
C) 函数指针只能接受闭包，不能接受命名函数
D) 函数指针与 `Fn` trait 完全等价，不能区分
= A
+ 本节：`fn` 是函数指针类型，不是 trait；它实现三个闭包 trait，所以可传给期望闭包的函数。

### 为什么不能直接写 `fn returns_closure() -> Fn(i32) -> i32` 返回闭包？
~ 返回闭包/trait 对象
A) 闭包表现为 trait 且大小未知，需返回 `Box<dyn Fn(i32) -> i32>` 等 trait 对象
B) 闭包没有实现 `Fn` trait，所以任何返回方式都不行
C) 只有把返回类型改成 `fn(i32) -> i32` 才能返回闭包
D) 闭包必须在 unsafe 块中创建
= A
+ 闭包是 trait，编译器不知道所需空间；用 trait 对象 Box<dyn Fn...> 返回。

### 与函数相比，宏的一个关键能力是什么？
~ 宏/宏与函数区别
A) 宏可以接受不同数量的参数，并在编译前展开以生成代码
B) 宏只能在运行时被调用，因此能访问更多运行时类型信息
C) 宏定义一定比函数定义更简单、更易读
D) 宏可以在调用之后才定义，函数必须先定义后调用
= A
+ 本节：宏可接受不同数量参数，编译前展开；函数参数个数和类型固定。宏定义通常更复杂；宏需在调用前定义或引入。

### 在 `macro_rules!` 定义中，`$( $x:expr ),*` 里的 `*` 表示什么？
~ 声明宏/macro_rules 模式
A) 匹配零个或更多个逗号分隔的 `$x:expr` 模式
B) 对匹配到的表达式做乘法运算
C) 表示该模式只能匹配恰好一个表达式
D) 表示宏展开后必须返回一个指针
= A
+ `$()` 后逗号再跟 `*` 表示零个或多个由逗号分隔的匹配。

### 类属性宏与自定义派生宏相比，下列哪项是本节说明的区别？
~ 过程宏/派生宏区别
A) 派生宏只能用于结构体和枚举，类属性宏还可用于函数等其他项
B) 类属性宏只能用于结构体和枚举，派生宏可用于任意项
C) 类属性宏不接受 `TokenStream` 参数
D) 派生宏不需要单独的 proc-macro crate
= A
+ 本节：derive 只能用于结构体和枚举；属性还可用于其他项，比如函数。

## 最后的项目: 构建多线程 Web 服务器

### 关于本节中 Web 服务器涉及的两个主要协议 HTTP 和 TCP，下列哪项描述正确？
~ web服务器/http与tcp的关系
A) TCP 是底层协议，描述信息如何传输；HTTP 构建于 TCP 之上，定义请求和响应的内容
B) HTTP 是底层协议，描述字节如何传输；TCP 构建于 HTTP 之上，定义请求和响应的内容
C) 两者都是无连接协议，服务端主动发起请求而客户端只监听
D) HTTP 和 TCP 都是请求-响应协议，但都由服务端先发起请求
= A
+ 本节指出 TCP 是底层协议，描述信息如何从服务器到另一个的细节，而 HTTP 构建于 TCP 之上，定义请求和响应的内容。

### 本节中 `TcpListener::bind` 返回 `Result`，下列哪组是文中给出的绑定可能失败的原因？
~ web服务器/bind失败原因
A) 非管理员用户尝试监听 80 端口，或两个程序实例监听同一端口
B) 只要端口号小于 1024 就必然失败，与权限无关
C) 只要 IP 地址是 127.0.0.1 就一定失败
D) 端口号为偶数时绑定会失败
= A
+ 本节举了两例：连接 80 端口需要管理员权限；运行两个实例会监听相同端口而失败。

### 关于 `TcpListener` 的 `incoming` 方法，本节的说法正确的是？
~ web服务器/incoming返回连接尝试
A) 它返回一个迭代器，提供的是一系列连接尝试，每个尝试可能成功或失败
B) 它返回一个永远打开的单一 TcpStream
C) 它返回一个包含所有已建立连接的 Vec<TcpStream>
D) 它直接返回已经解析完毕的 HTTP 请求字符串
= A
+ 本节说明 `incoming` 返回迭代器，遍历的是连接尝试而非连接，连接可能因操作系统相关原因失败。

### 在 `handle_connection` 中 `stream` 参数需要是 `mut` 的，本节给出的原因是什么？
~ web服务器/读取请求需要可变流
A) TcpStream 内部记录了所返回的数据，可能读取并保存多于请求的数据以备下次使用，其内部状态会改变
B) 因为只有可变引用才能调用 read，这是借用规则的硬性规定
C) 因为要把它移交给另一个线程，必须可变
D) 因为 flush 方法只能用于可变引用
= A
+ 本节说通常认为“读取”不需要可变性，但 TcpStream 会内部保存可能多读的数据，所以需要 mut。

### 本节使用 `String::from_utf8_lossy` 处理缓冲区字节，当遇到无效 UTF-8 序列时它的行为是？
~ web服务器/from_utf8_lossy替换字符
A) 用 �（U+FFFD REPLACEMENT CHARACTER）替换无效序列
B) 直接丢弃整个缓冲区并返回空字符串
C) panic 并终止程序
D) 把无效字节转换为对应的 ASCII 字符
= A
+ “lossy”部分源于遇到无效 UTF-8 序列时用 U+FFFD 替换。

### 本节中 HTTP 请求行的格式是？
~ web服务器/http请求行格式
A) Method Request-URI HTTP-Version CRLF
B) HTTP-Version Status-Code Reason-Phrase CRLF
C) Request-URI Method HTTP-Version CRLF
D) Method HTTP-Version Request-URI CRLF
= A
+ 请求行存放 method、请求 URI、HTTP 版本，并以 CRLF 结束；HTTP-Version Status-Code Reason-Phrase 是响应状态行。

### 本节中 CRLF 序列（也可写成 `\r\n`）的作用是什么？
~ web服务器/crlf分隔
A) 将请求行与其余请求数据分开
B) 表示整个 HTTP 请求的结束，之后不再有数据
C) 用于加密请求内容
D) 表示 TCP 连接已被关闭
= A
+ 本节说 CRLF 序列将请求行与其余请求数据分开；响应中它还分隔状态行、header 与 body。

### 本节中把响应写入流之后调用 `flush` 的作用是什么？
~ web服务器/响应的flush作用
A) 等待并阻塞直到所有字节都被写入连接中，因为 TcpStream 有内部缓冲区
B) 清空缓冲区中尚未读取的请求数据
C) 关闭 TCP 连接
D) 把响应从 UTF-8 转换为字节
= A
+ 本节说明 flush 会等待并阻塞直到所有字节写入连接；TcpStream 含内部缓冲区以最小化对操作系统的调用。

### 本节中为了只对 `/` 请求返回 HTML 而对其他请求返回 404，使用什么方式验证请求？
~ web服务器/starts_with验证请求
A) 用 `buffer.starts_with(get)` 检查缓冲区是否以硬编码的请求字节开头
B) 用 `buffer == get` 要求缓冲区与请求字节完全相等
C) 用正则表达式解析整个请求
D) 用 `buffer.ends_with(get)` 检查请求字节结尾
= A
+ 本节将 `GET / HTTP/1.1\r\n` 硬编码为字节字符串 `get`，并用 `starts_with` 检查缓冲区开头。

### 本节中引入线程池的主要目的是？
~ web服务器/线程池存在的目的
A) 用固定数量的线程并发处理请求，避免为每个请求创建线程而耗尽资源（如 DoS 攻击）
B) 让每个请求都创建自己的线程以提高吞吐量
C) 让服务器处理单个请求后立即停机
D) 自动为服务器分配无限的线程
= A
+ 本节强调为每个请求新建线程会潜在分配无限线程，线程池限制线程数以防拒绝服务攻击，同时并发处理连接。

### 本节中 `ThreadPool::new` 的 `size` 参数为什么选用 `usize` 类型？
~ web服务器/size参数用usize
A) 因为负的线程数没有意义，而 usize 是无符号类型
B) 因为 usize 是唯一能表示零的类型
C) 因为通道要求任务数量必须是 usize
D) 因为 JoinHandle 只能用 usize 索引
= A
+ 本节说选择 usize 是因为知道为负的线程数没有意义，并且它会被用作集合元素数量。

### 本节实现中 `ThreadPool::new` 在 `size` 为 0 时如何处理？
~ web服务器/new中断言size大于零
A) 使用 `assert!(size > 0)` 在得到零时 panic
B) 返回一个不含任何线程的空 ThreadPool 而不报错
C) 自动把 size 调整为 1
D) 返回 `Result` 并要求调用者处理零的情况
= A
+ 本节选择用 `assert!` 在 size 为 0 时 panic，认为创建无任何线程的线程池是不可恢复错误（Result 版本只是练习提议）。

### 尝试把通道接收端直接传给多个 `Worker` 时编译失败，本节给出的根本原因是什么？
~ web服务器/通道接收端不能克隆
A) 通道实现是多生产者单消费者的，接收端不能克隆，且取出任务需要修改接收端
B) Receiver 类型没有实现 Send trait
C) Mutex 不能包裹 Receiver 类型
D) 通道的接收端在创建后立即被关闭
= A
+ 本节说明 mpsc 是单消费者，不能简单克隆接收端；且取出任务涉及修改接收端，需要安全的共享与修改方式。

### 本节中为什么用 `Arc<Mutex<Receiver<Job>>>` 来在多个 worker 间共享接收端？
~ web服务器/arc与mutex共享接收端
A) Arc 让多个 worker 共享接收端所有权，Mutex 确保一次只有一个 worker 能从接收端取任务
B) Arc 保证线程安全，Mutex 用于放大接收缓冲区
C) Mutex 用来克隆接收端，Arc 用来发送终止信号
D) 两者都是为了绕过通道而直接共享数据
= A
+ 本节明确：Arc 使多个 worker 拥有接收端，Mutex 确保一次只有一个 worker 从接收端得到任务，避免竞争。

### 本节中 `Job` 被定义成什么？
~ web服务器/job类型别名
A) `type Job = Box<dyn FnOnce() + Send + 'static>;`，即存放闭包的 trait 对象类型别名
B) 一个存放 id 和 JoinHandle 的结构体
C) 一个表示终止信号的枚举成员
D) 一个持有 receiver 的智能指针
= A
+ 本节把 `Job` 从结构体改为类型别名，用于存放 execute 接收到的闭包的 Box trait 对象。

### 本节中 `ThreadPool::execute` 对闭包参数 `F` 使用了什么 trait bound，理由是什么？
~ web服务器/execute闭包的trait-bound
A) `FnOnce() + Send + 'static`：任务只执行一次、需跨线程转移、不知道线程执行多久
B) `Fn() + Sync + 'static`：任务需要被多次执行
C) `FnMut() + Copy`：任务需要可复制
D) `FnOnce() + Sync`：任务需要被多个线程同时引用
= A
+ 本节参照 thread::spawn 的签名，选择 FnOnce（只执行一次）、Send（跨线程转移）、'static（不知线程执行多久）。

### 本节示例 20-21 用 `while let Ok(job) = receiver.lock().unwrap().recv()` 会有什么问题？
~ web服务器/while-let持有锁的问题
A) while 表达式中的值在整个块一直存活，导致 `job()` 调用期间仍持有锁，其他 worker 无法取任务
B) 代码无法编译，因为 while let 不能用于 Receiver
C) recv 会立即返回 Err 使循环一次也不执行
D) lock 返回的 MutexGuard 会在 recv 之前被丢弃，导致数据竞争
= A
+ 本节解释 while 中的值存活整个块，MutexGuard 在 job() 调用时仍存在，锁未释放；改成 loop 内 let job 可在调用 job() 前释放锁。

### 在 `Drop` 实现中对 worker 调用 `join` 时，为什么把 `thread` 字段改为 `Option<JoinHandle<()>>`？
~ web服务器/drop中用option-take移动线程
A) join 需要获取线程的所有权，而这里只有 worker 的借用；用 Option 上的 take 把线程移动出来
B) 因为 JoinHandle 只有在 Option 中才能调用 join
C) 为了在线程 panic 时能自动忽略错误
D) 因为 Drop 的 drop 方法中不能使用可变引用
= A
+ 本节说不能移动出借用内容，改为 Option 后用 take 取出 Some 中的线程再 join，留下 None。

### 本节中 `Drop` 实现为什么用两个分开的循环（先向所有 worker 发 Terminate，再逐个 join）？
~ web服务器/drop中两个循环避免死锁
A) 若在同一循环中发消息后立即 join，可能被 join 的 worker 没收到终止消息而其他 worker 抢先收到，造成死锁
B) 因为通道一次只能发送两条消息
C) 因为 join 必须在发送消息之前调用
D) 因为一个循环中不能同时访问 sender 和 workers
= A
+ 本节用两个 worker 的例子说明：边发消息边 join 时，终止消息可能被别的空闲 worker 收到，导致被 join 的忙碌 worker 永远不结束，形成死锁。

### 本节中通道改为发送 `Message` 枚举，其两个成员是什么，各自作用？
~ web服务器/message枚举terminate信号
A) `NewJob(Job)` 表示要执行的任务，`Terminate` 表示线程应退出循环并终止
B) `Start` 表示启动线程，`Stop` 表示暂停线程
C) `NewJob(Job)` 表示接收任务，`Terminate` 表示接收端关闭通道
D) `Ok` 表示成功，`Err` 表示失败
= A
+ 本节定义 Message 为 NewJob(Job) 或 Terminate，worker 收到 NewJob 执行任务，收到 Terminate 则 break 退出循环。

## 附录

### 关于 Rust 关键字用作标识符，下列哪项正确？
~ 附录/关键字作为标识符
A) 关键字不能用作函数、变量等标识符，除非使用原始标识符
B) 关键字可以在任何位置直接用作标识符
C) 保留关键字都已经有对应功能
D) 原始标识符的前缀是 #r
= A
+ 关键字不能被用作标识符，除了原始标识符介绍的情况。

### 关键字 `as` 可以用于做什么？
~ 附录/关键字 as
A) 强制类型转换、消除特定包含项的 trait 歧义，或对 `use` 和 `extern crate` 语句中的项重命名
B) 定义枚举
C) 进行模式匹配
D) 表示全局变量
= A
+ 附录中列出 `as` 的这些用途。

### 关键字 `await` 的作用是什么？
~ 附录/关键字 await
A) 暂停执行，直到 `Future` 的结果准备好
B) 返回一个 `Future` 而不是阻塞当前线程
C) 立刻退出循环
D) 使闭包获取其所捕获项的所有权
= A
+ `await` 暂停执行，直到 `Future` 的结果准备好。

### 下列哪一项是保留做将来使用的关键字？
~ 附录/保留关键字
A) abstract
B) async
C) dyn
D) where
= A
+ `abstract` 在保留关键字列表中，目前没有功能。

### 若要把关键字 `match` 用作函数名，正确的写法是？
~ 附录/原始标识符语法
A) fn r#match(...)
B) fn #match(...)
C) fn raw match(...)
D) fn match!(...)
= A
+ 原始标识符使用 `r#` 前缀，例如 `r#match`。

### 如果 2015 edition 编写的库中带有 `try` 函数，在 2018 edition 中调用时，应使用哪种语法？
~ 附录/原始标识符跨版本
A) r#try
B) try
C) try!
D) #[try]
= A
+ `try` 在 2018 edition 是关键字，调用旧库中的该函数需使用原始标识符 `r#try`。

### 运算符 `?` 在附录的运算符表中表示什么？
~ 附录/运算符问号
A) 错误传播
B) 模式绑定
C) 复合类型限制
D) 解引用
= A
+ `expr?` 表示错误传播。

### 运算符 `@` 在模式中的用途是什么？
~ 附录/运算符 at
A) 模式绑定
B) 按位异或
C) 宏重复
D) 错误传播
= A
+ `ident @ pat` 表示模式绑定。

### 符号 `_` 的非运算符含义是什么？
~ 附录/下划线符号
A) “忽略”模式绑定；也用于增强整型字面量的可读性
B) 表示闭包
C) 表示总是为空的 never type
D) 表示原始字符串字面量
= A
+ 附录表 B-2 中 `_` 表示“忽略”模式绑定，也用于增强整型字面量的可读性。

### 路径语法 `super::path` 表示什么？
~ 附录/路径 super
A) 与父模块相对的路径
B) 与 crate 根相对的路径
C) 与当前模块相对的路径
D) 关联常量、函数以及类型
= A
+ `super::path` 表示与父模块相对的路径。

### 路径语法 `::path` 表示什么？
~ 附录/路径 crate根
A) 与 crate 根相对的路径（如一个显式绝对路径）
B) 与父模块相对的路径
C) 与当前模块相对的路径
D) 为泛型指定具体参数
= A
+ `::path` 表示与 crate 根相对的路径。

### 泛型语法 `path::<...>` 或 `method::<...>` 的用途是什么？
~ 附录/泛型 turbofish
A) 为泛型、函数或表达式中的方法指定具体参数，通常指 turbofish
B) 定义泛型结构体
C) 指定高级生命周期限制
D) 定义泛型实现
= A
+ `path::<...>` 和 `method::<...>` 通常指 turbofish，用于指定具体参数。

### trait bound 语法 `T: ?Sized` 表示什么？
~ 附录/trait bound 不定大小
A) 使用一个不定大小的泛型类型
B) 泛型 `T` 不包含除 `'static` 之外的借用引用
C) 泛型 `'b` 生命周期必须长于泛型 `'a`
D) 泛型参数 `T` 约束于实现了 `U` 的类型
= A
+ `T: ?Sized` 表示使用一个不定大小的泛型类型。

### 宏与属性语法中，`#![meta]` 表示什么？
~ 附录/内部属性语法
A) 内部属性
B) 外部属性
C) 宏替换
D) 宏重复
= A
+ `#[meta]` 是外部属性，`#![meta]` 是内部属性。

### 注释符号 `//!` 表示什么？
~ 附录/内部行文档注释
A) 内部行文档注释
B) 外部行文档注释
C) 块注释
D) 内部块文档注释
= A
+ `//!` 表示内部行文档注释。

### 元组相关语法 `(expr,)` 表示什么？
~ 附录/单元组表达式
A) 单一元素元组表达式
B) 括号表达式
C) 空元组
D) 单一元素元组类型
= A
+ `(expr,)` 是单一元素元组表达式，`(type,)` 是单一元素元组类型。

### 方括号语法 `[expr; len]` 表示什么？
~ 附录/数组重复语法
A) 复制了 `len` 个 `expr` 的数组
B) 包含 `len` 个 `type` 类型的数组
C) 复制了 `len` 个 `type` 的数组
D) 集合索引
= A
+ `[expr; len]` 表示复制了 `len` 个 `expr` 的数组。

### `Debug` trait 在格式化字符串中如何表明调试格式？
~ 附录/派生 Debug
A) 在 `{}` 占位符中增加 `:?`
B) 在 `{}` 占位符中增加 `#`
C) 直接用 `{}` 为用户显示
D) 使用 `?` 运算符传播错误
= A
+ `Debug` trait 通过在 `{}` 占位符中增加 `:?` 表明。

### 关于 `Eq` trait，下列哪项正确？
~ 附录/Eq 约束
A) `Eq` 没有方法，表明值等于其自身；只能用于实现了 `PartialEq` 的类型，浮点类型不能实现 `Eq`
B) `Eq` 定义 `cmp` 方法并返回 `Ordering`
C) `Eq` 开启 `<`、`>`、`<=` 和 `>=` 运算符
D) `Eq` 可以派生给所有实现了 `PartialEq` 的类型
= A
+ `Eq` 没有方法，且并非所有实现 `PartialEq` 的类型都能实现 `Eq`，浮点类型是例子。

### 在结构体上派生 `PartialOrd` 时，比较两个实例的顺序依据是什么？
~ 附录/派生 PartialOrd 字段顺序
A) 按结构体定义中字段出现的顺序比较每个字段的值
B) 按字段名的字母顺序比较
C) 只比较第一个字段
D) 只比较最后一个字段
= A
+ 结构体上派生 `PartialOrd` 按字段出现顺序比较每个字段的值。
