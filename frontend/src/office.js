// This function is serialized by ONLYOFFICE and runs inside the editor.
// Do not reference imports, closures, or Vue state here. Pass JSON through Asc.scope.
export function officeCommand() {
  try {
    var input = Asc.scope.input;
    var doc = Api.GetDocument();
    var controls = doc.GetAllContentControls();
    var target = controls.filter(function (c) {
      return c.GetTag() === input.tag;
    })[0];
    if (input.op === "appearance_get" || input.op === "appearance_set") {
      if (controls.some(function(c) { return typeof c.GetAppearance !== "function" || typeof c.SetAppearance !== "function"; })) {
        throw new Error("当前文档包含不支持外观设置的控件");
      }
      if (input.op === "appearance_set") {
        if (input.appearance !== "hidden" && input.appearance !== "boundingBox") throw new Error("无效的控件外观");
        controls.forEach(function(c) { if (c.GetAppearance() !== input.appearance) c.SetAppearance(input.appearance); });
      }
      var appearances = controls.map(function(c) { return c.GetAppearance(); });
      var state = !appearances.length ? "none" : appearances.every(function(a) {return a === appearances[0];}) ? appearances[0] : "mixed";
      if (input.op === "appearance_set" && controls.length && state !== input.appearance) throw new Error("部分控件外观未能修改，请重新连接读取实际状态");
      return {ok:true,appearance:state,count:controls.length};
    }
    if (input.op === "inspect") {
      return {
        ok: true,
        controls: controls.map(function (c) {
          return {
            tag: c.GetTag(),
            id: c.GetInternalId(),
            lock: c.GetLock(),
            text: c.GetContent ? c.GetContent().GetText() : c.GetText(),
          };
        }),
        capabilities: {
          UpdateAllFields: typeof doc.UpdateAllFields === "function",
          UpdateAllTOC: typeof doc.UpdateAllTOC === "function",
          GetAllImages: typeof doc.GetAllImages === "function",
        },
      };
    }
    if (input.op === "fill") {
      var changed = [];
      Object.keys(input.values).forEach(function (tag) {
        var c = controls.filter(function (x) {
          return x.GetTag() === tag;
        })[0];
        if (!c)
          throw new Error("找不到内容控件：" + tag + "。请使用验证样本。");
        var p = Api.CreateParagraph();
        p.AddText(input.values[tag]);
        c.RemoveAllElements();
        c.AddElement(p, 0);
        changed.push(tag);
      });
      return { ok: true, changed: changed };
    }
    if (input.op === "lock") {
      if (!target) throw new Error("样本中没有指定固定条款控件");
      target.SetLock(input.lock);
      return { ok: true, tag: input.tag, lock: target.GetLock() };
    }
    if (input.op === "image") {
      if (!target) throw new Error("未找到证明材料占位控件");
      var p = Api.CreateParagraph();
      p.SetJc("center");
      p.AddDrawing(Api.CreateImage(input.url, 4680000, 3135600));
      target.RemoveAllElements();
      target.AddElement(p, 0);
      return { ok: true, tag: input.tag, widthMm: 130, heightMm: 87.1 };
    }
    if (input.op === "resize") {
      if (!target || typeof target.GetAllDrawingObjects !== "function")
        throw new Error("没有可处理的证明材料区域");
      var drawings = target.GetAllDrawingObjects();
      if (!drawings.length) throw new Error("请先插入测试证书");
      drawings.forEach(function (d) {
        d.SetSize(3960000, 2653200);
      });
      return {
        ok: true,
        count: drawings.length,
        widthMm: 110,
        note: "仅处理样本证书区域，原图比例已知",
      };
    }
    if (input.op === "fields") {
      if (typeof doc.UpdateAllFields !== "function")
        throw new Error(
          "当前 9.2.1 未暴露 UpdateAllFields，请在引用菜单手工更新目录",
        );
      return {
        ok: true,
        result: doc.UpdateAllFields(),
        note: "仍需人工检查目录页码与交叉引用",
      };
    }
    if (input.op === "search") {
      var hits = doc.Search(input.text);
      if (!hits.length) throw new Error("文档中未找到：" + input.text);
      hits[0].Select();
      return { ok: true, count: hits.length, selected: 0 };
    }
    if (input.op === "audit") {
      var text = doc
        .GetAllParagraphs()
        .map(function (p) {
          return p.GetText();
        })
        .join("\n");
      var terms = input.terms;
      return {
        ok: true,
        findings: terms.map(function (t) {
          return { term: t, count: doc.Search(t).length };
        }),
        length: text.length,
        note: "简单关键词检查，不是完整语义或版式审查",
      };
    }
    throw new Error("未知操作");
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

export function method(connector, name, args = []) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(name + " 超时；编辑器可能未就绪或版本不支持")),
      20000,
    );
    try {
      connector.executeMethod(name, args, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}
// executeMethod getters preserve the editor's redo stack. Even a getter inside
// callCommand can start an editing action in 9.2.1, clearing redo history.
export async function readControlState(connector) {
  const controls = await method(connector, "GetAllContentControls");
  if (!Array.isArray(controls)) throw new Error("未返回有效的内容控件状态");
  return {controls:controls.map(c => ({tag:c.Tag,id:c.InternalId,
    lock:({0:"contentLocked",1:"sdtContentLocked",2:"sdtLocked",3:"unlocked"})[c.Lock] || c.Lock || "unknown",
    appearance:({1:"boundingBox",2:"hidden"})[c.Appearance] || c.Appearance || "unknown",
  }))};
}
export function command(connector, input) {
  window.Asc.scope.input = input;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Automation 命令超时，请检查编辑器并重新连接")),
      20000,
    );
    connector.callCommand(officeCommand, (value) => {
      clearTimeout(timer);
      if (!value || !value.ok)
        reject(new Error(value?.error || "命令未返回有效结果"));
      else resolve(value);
    });
  });
}
