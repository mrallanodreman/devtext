(function () {
  "use strict";

  var scriptEl = document.currentScript;
  var scriptUrl = new URL(scriptEl.src);
  var SERVER_ORIGIN = scriptUrl.origin;
  var PROJECT_PATH = scriptUrl.searchParams.get("projectPath") || "";

  var UI_MARKER = "data-devtext-ui";
  var IGNORE_TAGS = { SVG: 1, PATH: 1, SCRIPT: 1, STYLE: 1, BUTTON: 1, INPUT: 1, SELECT: 1 };
  var BASE_FONTS = ["system-ui", "Georgia", "Arial", "Times New Roman", "Courier New"];
  var SHADOW_PRESETS = [
    { label: "Ninguna", value: "none" },
    { label: "Sombra suave", value: "0 2px 8px rgba(0,0,0,0.25)" },
    { label: "Contorno", value: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000" },
    { label: "Elevado", value: "0 1px 0 rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.3)" },
  ];
  var TRANSFORM_PRESETS = [
    { label: "Ninguna", value: "none" },
    { label: "MAYÚSCULAS", value: "uppercase" },
    { label: "minúsculas", value: "lowercase" },
    { label: "Primera Letra", value: "capitalize" },
  ];

  function h(tag, props, children) {
    var node = document.createElement(tag);
    props = props || {};
    for (var k in props) {
      var v = props[k];
      if (v == null) continue;
      if (k === "style" && typeof v === "object") {
        for (var sk in v) node.style[sk] = v[sk];
      } else if (k.indexOf("on") === 0 && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "text") {
        node.textContent = v;
      } else if (k === "html") {
        node.innerHTML = v;
      } else {
        node.setAttribute(k, v);
      }
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function isTextElement(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (IGNORE_TAGS[el.tagName]) return false;
    if (el.closest("[" + UI_MARKER + "]")) return false;
    var text = (el.innerText || "").trim();
    if (!text) return false;
    var children = el.children;
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c instanceof HTMLElement && (c.innerText || "").trim() === text) return false;
    }
    return true;
  }

  function nearestSection(el) {
    var section = el.closest("section, header, footer");
    if (!section) return "?";
    if (section.id) return "#" + section.id;
    var all = Array.prototype.slice.call(document.querySelectorAll("section"));
    var idx = all.indexOf(section);
    return idx >= 0 ? "section " + (idx + 1) : section.tagName.toLowerCase();
  }

  function normalizeAlign(v) {
    return v === "left" || v === "center" || v === "right" || v === "justify" ? v : "left";
  }
  function normalizeTransform(v) {
    return v === "uppercase" || v === "lowercase" || v === "capitalize" ? v : "none";
  }
  function rgbToHex(rgb, fallback) {
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || "");
    if (!m) return fallback;
    return (
      "#" +
      [m[1], m[2], m[3]]
        .map(function (n) {
          return Number(n).toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  function readStyle(el) {
    var cs = window.getComputedStyle(el);
    var decoration = el.style.textDecorationLine || cs.textDecorationLine;
    return {
      fontFamily: el.style.fontFamily || cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      fontSize: Math.round(parseFloat(el.style.fontSize || cs.fontSize) || 16),
      bold: (el.style.fontWeight || cs.fontWeight) >= "600",
      italic: (el.style.fontStyle || cs.fontStyle) === "italic",
      underline: decoration.indexOf("underline") !== -1,
      strikethrough: decoration.indexOf("line-through") !== -1,
      align: normalizeAlign(el.style.textAlign || cs.textAlign),
      shadow: el.style.textShadow || "none",
      transform: normalizeTransform(el.style.textTransform || cs.textTransform),
      letterSpacing: Math.round(parseFloat(el.style.letterSpacing || cs.letterSpacing) || 0),
      lineHeight: Math.round((parseFloat(el.style.lineHeight || cs.lineHeight) / parseFloat(cs.fontSize)) * 10) / 10 || 1.4,
      color: rgbToHex(el.style.color || cs.color, "#ffffff"),
      background:
        el.style.backgroundColor && el.style.backgroundColor !== ""
          ? rgbToHex(el.style.backgroundColor, "transparent")
          : "transparent",
    };
  }

  function applyStyleToEl(el, s) {
    el.style.fontFamily = s.fontFamily;
    el.style.fontSize = s.fontSize + "px";
    el.style.fontWeight = s.bold ? "700" : "";
    el.style.fontStyle = s.italic ? "italic" : "";
    var decorations = [];
    if (s.underline) decorations.push("underline");
    if (s.strikethrough) decorations.push("line-through");
    el.style.textDecorationLine = decorations.length ? decorations.join(" ") : "none";
    el.style.textAlign = s.align;
    el.style.textShadow = s.shadow === "none" ? "" : s.shadow;
    el.style.textTransform = s.transform;
    el.style.letterSpacing = s.letterSpacing + "px";
    el.style.lineHeight = String(s.lineHeight);
    el.style.color = s.color;
    el.style.backgroundColor = s.background === "transparent" ? "" : s.background;
  }

  function btnStyle(activeState) {
    return {
      padding: "4px 8px",
      borderRadius: "4px",
      border: "1px solid #444",
      background: activeState ? "#c5a95e" : "#222",
      color: activeState ? "#171310" : "#fff",
      cursor: "pointer",
      fontFamily: "monospace",
      fontSize: "12px",
    };
  }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var active = false;
  var isEditing = false;
  var barOpen = false;
  var editingEl = null;
  var originalText = "";
  var style = null;
  var initialStyle = null;
  var fonts = BASE_FONTS.slice();
  var sourceNote = null;
  var history = [];
  var future = [];
  var hoverEl = null;

  // ---------------------------------------------------------------------
  // Fixed DOM: outline box, toggle button, toast
  // ---------------------------------------------------------------------
  var outlineBox = h("div", {
    style: {
      position: "absolute",
      pointerEvents: "none",
      border: "2px solid #ff4d4f",
      background: "rgba(255,77,79,0.08)",
      borderRadius: "4px",
      opacity: "0",
      transition: "opacity 0.1s",
      zIndex: "999998",
    },
  });

  var toggleBtn = h(
    "button",
    {
      type: "button",
      style: {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: "999999",
        padding: "10px 16px",
        borderRadius: "999px",
        border: "none",
        fontFamily: "monospace",
        fontSize: "13px",
        fontWeight: "700",
        cursor: "pointer",
        background: "#111",
        color: "#fff",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      },
      onclick: function () {
        active = !active;
        renderToggle();
      },
    },
    ["✎ Dev.Text"]
  );
  toggleBtn.setAttribute(UI_MARKER, "true");

  var toastBox = h("div", {
    style: {
      position: "fixed",
      bottom: "68px",
      right: "20px",
      zIndex: "999999",
      maxWidth: "420px",
      padding: "10px 14px",
      borderRadius: "8px",
      fontFamily: "monospace",
      fontSize: "12px",
      background: "#111",
      color: "#0f0",
      boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      display: "none",
    },
  });

  var toolbarEl = null;
  var toastTimer = null;

  function renderToggle() {
    toggleBtn.style.display = isEditing ? "none" : "block";
    toggleBtn.style.background = active ? "#ff4d4f" : "#111";
    toggleBtn.textContent = active ? "✎ Edit Mode (click en texto)" : "✎ Dev.Text";
  }

  function showToast(text, durationMs) {
    toastBox.textContent = text.length > 160 ? text.slice(0, 160) + "…" : text;
    toastBox.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastBox.style.display = "none";
    }, durationMs || 3200);
  }

  // ---------------------------------------------------------------------
  // Dropdown (opens upward)
  // ---------------------------------------------------------------------
  function makeDropdown(labelText, value, options, onChange) {
    var wrap = h("div", { style: { position: "relative" } });
    wrap.setAttribute(UI_MARKER, "true");
    var open = false;
    var menu = null;
    var docHandler = null;

    var current = options.filter(function (o) {
      return o.value === value;
    })[0];

    var btn = h("button", { type: "button", style: btnStyle(false) }, [labelText + ": " + (current ? current.label : value) + " ▴"]);
    btn.addEventListener("click", function () {
      open = !open;
      renderMenu();
    });
    wrap.appendChild(btn);

    function closeMenu() {
      open = false;
      if (menu) {
        menu.remove();
        menu = null;
      }
      if (docHandler) {
        document.removeEventListener("click", docHandler, true);
        docHandler = null;
      }
    }

    function renderMenu() {
      if (menu) {
        menu.remove();
        menu = null;
      }
      if (!open) return;
      menu = h("div", {
        style: {
          position: "absolute",
          bottom: "calc(100% + 8px)",
          left: "0",
          background: "#222",
          border: "1px solid #444",
          borderRadius: "6px",
          overflow: "hidden",
          minWidth: "160px",
          boxShadow: "0 -8px 20px rgba(0,0,0,0.4)",
          zIndex: "1000000",
        },
      });
      options.forEach(function (opt) {
        var optBtn = h(
          "button",
          {
            type: "button",
            style: {
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "7px 12px",
              background: opt.value === value ? "#c5a95e" : "transparent",
              color: opt.value === value ? "#171310" : "#fff",
              border: "none",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: "12px",
              whiteSpace: "nowrap",
            },
          },
          [opt.label]
        );
        optBtn.addEventListener("click", function () {
          onChange(opt.value);
          closeMenu();
        });
        menu.appendChild(optBtn);
      });
      wrap.appendChild(menu);
      docHandler = function (e) {
        if (!wrap.contains(e.target)) closeMenu();
      };
      document.addEventListener("click", docHandler, true);
    }

    return wrap;
  }

  // ---------------------------------------------------------------------
  // FontPicker
  // ---------------------------------------------------------------------
  function makeFontPicker() {
    var wrap = h("div", { style: { position: "relative" } });
    wrap.setAttribute(UI_MARKER, "true");
    var open = false;
    var query = "";
    var rawResults = [];
    var installing = false;
    var installMsg = null;
    var panel = null;
    var docHandler = null;
    var searchTimer = null;

    var btn = h("button", { type: "button", style: btnStyle(false) }, ["Fuente: " + style.fontFamily + " ▴"]);
    btn.addEventListener("click", function () {
      open = !open;
      render();
    });
    wrap.appendChild(btn);

    function close() {
      open = false;
      if (panel) {
        panel.remove();
        panel = null;
      }
      if (docHandler) {
        document.removeEventListener("click", docHandler, true);
        docHandler = null;
      }
    }

    function searchGoogleFonts() {
      clearTimeout(searchTimer);
      if (query.trim().length < 2) {
        rawResults = [];
        render();
        return;
      }
      searchTimer = setTimeout(function () {
        fetch(SERVER_ORIGIN + "/api/fonts?q=" + encodeURIComponent(query.trim().toLowerCase()))
          .then(function (r) {
            return r.json();
          })
          .then(function (d) {
            rawResults = d.results || [];
            render();
          })
          .catch(function () {});
      }, 250);
    }

    function loadGoogleFont(slug, label) {
      fetch(SERVER_ORIGIN + "/api/fonts?family=" + encodeURIComponent(slug))
        .then(function (r) {
          if (!r.ok) throw new Error("not found");
          var familyName = r.headers.get("X-Font-Label") || label;
          return r.arrayBuffer().then(function (buf) {
            return { buf: buf, familyName: familyName };
          });
        })
        .then(function (res) {
          var face = new FontFace(res.familyName, res.buf);
          return face.load().then(function () {
            document.fonts.add(face);
            sourceNote = "Google Fonts family: " + res.familyName + " (slug: " + slug + ") — install via next/font/google or self-host";
            if (fonts.indexOf(res.familyName) === -1) fonts.unshift(res.familyName);
            updateStyle({ fontFamily: res.familyName });
            close();
          });
        })
        .catch(function () {});
    }

    function installFontsource() {
      var slug = query.trim().toLowerCase().replace(/\s+/g, "-");
      if (!slug) return;
      installing = true;
      installMsg = null;
      render();
      fetch(SERVER_ORIGIN + "/api/fontsource", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug, projectPath: PROJECT_PATH }),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            return { ok: r.ok, data: data };
          });
        })
        .then(function (res) {
          if (!res.ok) {
            installMsg = res.data.error || "Error instalando";
            installing = false;
            render();
            return;
          }
          var file = res.data.files[0];
          return fetch(
            SERVER_ORIGIN + "/api/fontsource?slug=" + slug + "&file=" + encodeURIComponent(file) + "&projectPath=" + encodeURIComponent(PROJECT_PATH)
          )
            .then(function (r2) {
              return r2.arrayBuffer();
            })
            .then(function (buf) {
              var familyName = "FS-" + slug;
              var face = new FontFace(familyName, buf);
              return face.load().then(function () {
                document.fonts.add(face);
                sourceNote =
                  "Fontsource package installed: @fontsource/" + slug + " — needs import wiring in layout.tsx/globals.css for permanent use";
                if (fonts.indexOf(familyName) === -1) fonts.unshift(familyName);
                updateStyle({ fontFamily: familyName });
                installMsg = "Instalado @fontsource/" + slug + " ✓";
                installing = false;
                render();
              });
            });
        })
        .catch(function () {
          installMsg = "Error instalando";
          installing = false;
          render();
        });
    }

    function render() {
      btn.textContent = "Fuente: " + style.fontFamily + " ▴";
      if (panel) {
        panel.remove();
        panel = null;
      }
      if (!open) return;

      panel = h("div", {
        style: {
          position: "absolute",
          bottom: "calc(100% + 8px)",
          left: "0",
          background: "#222",
          border: "1px solid #444",
          borderRadius: "6px",
          width: "300px",
          maxHeight: "380px",
          overflowY: "auto",
          boxShadow: "0 -8px 20px rgba(0,0,0,0.4)",
          zIndex: "1000000",
          padding: "8px",
        },
      });

      var input = h("input", {
        placeholder: "Buscar Google Fonts o instalar de Fontsource…",
        style: {
          width: "100%",
          padding: "6px 8px",
          background: "#111",
          color: "#fff",
          border: "1px solid #444",
          borderRadius: "4px",
          fontFamily: "monospace",
          fontSize: "12px",
          marginBottom: "8px",
          boxSizing: "border-box",
        },
      });
      input.value = query;
      input.addEventListener("input", function (e) {
        query = e.target.value;
        searchGoogleFonts();
        renderExtras();
      });
      panel.appendChild(input);

      panel.appendChild(h("div", { style: { fontSize: "10px", opacity: "0.6", marginBottom: "4px" } }, ["Tus fuentes"]));
      fonts.forEach(function (f) {
        var fb = h(
          "button",
          {
            type: "button",
            style: {
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "6px 8px",
              background: f === style.fontFamily ? "#c5a95e" : "transparent",
              color: f === style.fontFamily ? "#171310" : "#fff",
              border: "none",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: "12px",
            },
          },
          [f]
        );
        fb.addEventListener("click", function () {
          updateStyle({ fontFamily: f });
          close();
        });
        panel.appendChild(fb);
      });

      var extrasContainer = h("div", {});
      panel.appendChild(extrasContainer);

      function renderExtras() {
        extrasContainer.innerHTML = "";
        var q2 = query.trim().length < 2 ? [] : rawResults;
        if (q2.length > 0) {
          extrasContainer.appendChild(h("div", { style: { fontSize: "10px", opacity: "0.6", margin: "8px 0 4px" } }, ["Google Fonts (local)"]));
          q2.forEach(function (r) {
            var rb = h(
              "button",
              {
                type: "button",
                style: {
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 8px",
                  background: "transparent",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "monospace",
                  fontSize: "12px",
                },
              },
              [r.label]
            );
            rb.addEventListener("click", function () {
              loadGoogleFont(r.slug, r.label);
            });
            extrasContainer.appendChild(rb);
          });
        }
        if (query.trim().length >= 2) {
          var box = h("div", { style: { marginTop: "8px", borderTop: "1px solid #333", paddingTop: "8px" } });
          var installBtn = h(
            "button",
            {
              type: "button",
              style: Object.assign({}, btnStyle(false), { width: "100%", boxSizing: "border-box" }),
            },
            [installing ? "Instalando…" : '⇩ Instalar "' + query.trim() + '" de Fontsource']
          );
          installBtn.disabled = installing;
          installBtn.addEventListener("click", installFontsource);
          box.appendChild(installBtn);
          if (installMsg) box.appendChild(h("div", { style: { fontSize: "10px", marginTop: "4px", color: "#0f0" } }, [installMsg]));
          extrasContainer.appendChild(box);
        }
      }
      renderExtras();

      wrap.appendChild(panel);
      docHandler = function (e) {
        if (!wrap.contains(e.target)) close();
      };
      document.addEventListener("click", docHandler, true);
      input.focus();
    }

    wrap._render = render;
    return wrap;
  }

  // ---------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------
  function updateStyle(patch) {
    if (!style) return;
    history.push(style);
    future = [];
    style = Object.assign({}, style, patch);
    if (editingEl) applyStyleToEl(editingEl, style);
    renderToolbar();
  }

  function undo() {
    if (!style || history.length === 0) return;
    var prev = history.pop();
    future.push(style);
    style = prev;
    if (editingEl) applyStyleToEl(editingEl, style);
    renderToolbar();
  }

  function redo() {
    if (!style || future.length === 0) return;
    var next = future.pop();
    history.push(style);
    style = next;
    if (editingEl) applyStyleToEl(editingEl, style);
    renderToolbar();
  }

  function renderToolbar() {
    if (toolbarEl) {
      toolbarEl.remove();
      toolbarEl = null;
    }
    if (!isEditing || !style) return;

    toolbarEl = h("div", {
      style: {
        position: "fixed",
        bottom: "0",
        left: "0",
        right: "0",
        zIndex: "999999",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px",
        padding: "14px 20px 14px 84px",
        background: "#111",
        borderTop: "1px solid #333",
        boxShadow: "0 -8px 24px rgba(0,0,0,0.45)",
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#fff",
        transform: barOpen ? "translateY(0)" : "translateY(100%)",
        opacity: barOpen ? "1" : "0",
        transition: "transform 0.28s cubic-bezier(0.16,1,0.3,1), opacity 0.2s",
      },
    });
    toolbarEl.setAttribute(UI_MARKER, "true");

    toolbarEl.appendChild(makeFontPicker());

    var uploadInput = h("input", { type: "file", accept: ".ttf,.otf,.woff,.woff2", hidden: "true" });
    uploadInput.addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var name = "Custom-" + file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]/g, "");
      file.arrayBuffer().then(function (buf) {
        var face = new FontFace(name, buf);
        face
          .load()
          .then(function () {
            document.fonts.add(face);
            if (fonts.indexOf(name) === -1) fonts.unshift(name);
            sourceNote = "uploaded font file: " + file.name + " (needs saving to public/fonts + next/font/local wiring)";
            updateStyle({ fontFamily: name });
          })
          .catch(function () {
            showToast("✕ No se pudo cargar esa fuente");
          });
      });
      e.target.value = "";
    });
    var uploadBtn = h("button", { type: "button", style: btnStyle(false) }, ["⇪ Subir fuente"]);
    uploadBtn.addEventListener("click", function () {
      uploadInput.click();
    });
    toolbarEl.appendChild(uploadBtn);
    toolbarEl.appendChild(uploadInput);

    var sizeWrap = h("div", { style: { display: "flex", alignItems: "center", gap: "4px" } });
    var sizeMinus = h("button", { type: "button", style: btnStyle(false) }, ["A-"]);
    sizeMinus.addEventListener("click", function () {
      updateStyle({ fontSize: Math.max(8, style.fontSize - 1) });
    });
    var sizeLabel = h("span", { style: { minWidth: "28px", textAlign: "center" } }, [String(style.fontSize)]);
    var sizePlus = h("button", { type: "button", style: btnStyle(false) }, ["A+"]);
    sizePlus.addEventListener("click", function () {
      updateStyle({ fontSize: style.fontSize + 1 });
    });
    sizeWrap.appendChild(sizeMinus);
    sizeWrap.appendChild(sizeLabel);
    sizeWrap.appendChild(sizePlus);
    toolbarEl.appendChild(sizeWrap);

    var boldBtn = h("button", { type: "button", style: btnStyle(style.bold), title: "Negrita" }, [h("b", {}, ["B"])]);
    boldBtn.addEventListener("click", function () {
      updateStyle({ bold: !style.bold });
    });
    toolbarEl.appendChild(boldBtn);

    var italicBtn = h("button", { type: "button", style: btnStyle(style.italic), title: "Cursiva" }, [h("i", {}, ["I"])]);
    italicBtn.addEventListener("click", function () {
      updateStyle({ italic: !style.italic });
    });
    toolbarEl.appendChild(italicBtn);

    var underlineBtn = h("button", { type: "button", style: btnStyle(style.underline), title: "Subrayado" }, [h("u", {}, ["U"])]);
    underlineBtn.addEventListener("click", function () {
      updateStyle({ underline: !style.underline });
    });
    toolbarEl.appendChild(underlineBtn);

    var strikeBtn = h("button", { type: "button", style: btnStyle(style.strikethrough), title: "Tachado" }, [h("s", {}, ["S"])]);
    strikeBtn.addEventListener("click", function () {
      updateStyle({ strikethrough: !style.strikethrough });
    });
    toolbarEl.appendChild(strikeBtn);

    toolbarEl.appendChild(
      makeDropdown(
        "Alinear",
        style.align,
        [
          { label: "Izquierda", value: "left" },
          { label: "Centro", value: "center" },
          { label: "Derecha", value: "right" },
          { label: "Justificado", value: "justify" },
        ],
        function (v) {
          updateStyle({ align: v });
        }
      )
    );

    toolbarEl.appendChild(
      makeDropdown("Mayús/minús", style.transform, TRANSFORM_PRESETS, function (v) {
        updateStyle({ transform: v });
      })
    );

    toolbarEl.appendChild(
      makeDropdown("Efecto", style.shadow, SHADOW_PRESETS, function (v) {
        updateStyle({ shadow: v });
      })
    );

    var lsWrap = h("div", { style: { display: "flex", alignItems: "center", gap: "4px" }, title: "Espaciado entre letras (px)" });
    lsWrap.appendChild(h("span", {}, ["Aa↔"]));
    var lsMinus = h("button", { type: "button", style: btnStyle(false) }, ["-"]);
    lsMinus.addEventListener("click", function () {
      updateStyle({ letterSpacing: style.letterSpacing - 1 });
    });
    var lsLabel = h("span", { style: { minWidth: "22px", textAlign: "center" } }, [String(style.letterSpacing)]);
    var lsPlus = h("button", { type: "button", style: btnStyle(false) }, ["+"]);
    lsPlus.addEventListener("click", function () {
      updateStyle({ letterSpacing: style.letterSpacing + 1 });
    });
    lsWrap.appendChild(lsMinus);
    lsWrap.appendChild(lsLabel);
    lsWrap.appendChild(lsPlus);
    toolbarEl.appendChild(lsWrap);

    var lhWrap = h("div", { style: { display: "flex", alignItems: "center", gap: "4px" }, title: "Interlineado" });
    lhWrap.appendChild(h("span", {}, ["↕"]));
    var lhMinus = h("button", { type: "button", style: btnStyle(false) }, ["-"]);
    lhMinus.addEventListener("click", function () {
      updateStyle({ lineHeight: Math.round((style.lineHeight - 0.1) * 10) / 10 });
    });
    var lhLabel = h("span", { style: { minWidth: "26px", textAlign: "center" } }, [style.lineHeight.toFixed(1)]);
    var lhPlus = h("button", { type: "button", style: btnStyle(false) }, ["+"]);
    lhPlus.addEventListener("click", function () {
      updateStyle({ lineHeight: Math.round((style.lineHeight + 0.1) * 10) / 10 });
    });
    lhWrap.appendChild(lhMinus);
    lhWrap.appendChild(lhLabel);
    lhWrap.appendChild(lhPlus);
    toolbarEl.appendChild(lhWrap);

    var colorLabel = h("label", { style: { display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }, title: "Color de texto" });
    colorLabel.appendChild(h("span", {}, ["Color"]));
    var colorInput = h("input", {
      type: "color",
      style: { width: "24px", height: "24px", border: "1px solid #444", borderRadius: "4px", padding: "0", background: "none", cursor: "pointer" },
    });
    colorInput.value = style.color;
    colorInput.addEventListener("input", function (e) {
      updateStyle({ color: e.target.value });
    });
    colorLabel.appendChild(colorInput);
    toolbarEl.appendChild(colorLabel);

    var bgLabel = h("label", { style: { display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }, title: "Color de fondo" });
    bgLabel.appendChild(h("span", {}, ["Fondo"]));
    var bgInput = h("input", {
      type: "color",
      style: { width: "24px", height: "24px", border: "1px solid #444", borderRadius: "4px", padding: "0", background: "none", cursor: "pointer" },
    });
    bgInput.value = style.background === "transparent" ? "#000000" : style.background;
    bgInput.addEventListener("input", function (e) {
      updateStyle({ background: e.target.value });
    });
    bgLabel.appendChild(bgInput);
    var bgClear = h("button", { type: "button", style: btnStyle(false) }, ["✕"]);
    bgClear.addEventListener("click", function () {
      updateStyle({ background: "transparent" });
    });
    bgLabel.appendChild(bgClear);
    toolbarEl.appendChild(bgLabel);

    var undoBtn = h("button", { type: "button", style: btnStyle(false), title: "Deshacer estilo (el texto usa Ctrl+Z nativo)" }, ["↺"]);
    undoBtn.addEventListener("click", undo);
    toolbarEl.appendChild(undoBtn);

    var redoBtn = h("button", { type: "button", style: btnStyle(false), title: "Rehacer estilo" }, ["↻"]);
    redoBtn.addEventListener("click", redo);
    toolbarEl.appendChild(redoBtn);

    var saveBtn = h("button", { type: "button", style: Object.assign({}, btnStyle(false), { background: "#2e7d32", marginLeft: "auto" }) }, [
      "✓ Guardar y copiar",
    ]);
    saveBtn.addEventListener("click", function () {
      closeEditor(true);
    });
    toolbarEl.appendChild(saveBtn);

    document.body.appendChild(toolbarEl);
    requestAnimationFrame(function () {
      barOpen = true;
      toolbarEl.style.transform = "translateY(0)";
      toolbarEl.style.opacity = "1";
    });
  }

  // ---------------------------------------------------------------------
  // Edit lifecycle
  // ---------------------------------------------------------------------
  function openEditor(el) {
    originalText = el.innerText.trim();
    el.contentEditable = "true";
    el.spellcheck = true;
    el.focus();
    outlineBox.style.opacity = "0";
    editingEl = el;
    history = [];
    future = [];
    sourceNote = null;
    style = readStyle(el);
    initialStyle = Object.assign({}, style);
    isEditing = true;
    barOpen = false;
    renderToggle();
    renderToolbar();
  }

  // Translate the editor's style object into a plain CSS-in-JS object (the
  // same shape React expects in a `style={{...}}` prop) so it can be written
  // straight into JSX, not just previewed live in the browser.
  function toCssStyle(s) {
    var decorations = [];
    if (s.underline) decorations.push("underline");
    if (s.strikethrough) decorations.push("line-through");
    return {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize + "px",
      fontWeight: s.bold ? 700 : 400,
      fontStyle: s.italic ? "italic" : "normal",
      textDecorationLine: decorations.length ? decorations.join(" ") : "none",
      textAlign: s.align,
      textShadow: s.shadow === "none" ? "none" : s.shadow,
      textTransform: s.transform,
      letterSpacing: s.letterSpacing + "px",
      lineHeight: String(s.lineHeight),
      color: s.color,
      backgroundColor: s.background === "transparent" ? "transparent" : s.background,
    };
  }

  function closeEditor(commit) {
    var el = editingEl;
    var s = style;
    if (el && commit && s) {
      var text = el.innerText.trim();
      var textChanged = text !== originalText;
      var pathname = window.location.pathname;
      var section = nearestSection(el);
      var tag = el.tagName.toLowerCase();
      var changes = ["font: " + s.fontFamily, "size: " + s.fontSize + "px"];
      if (s.bold) changes.push("bold");
      if (s.italic) changes.push("italic");
      if (s.underline) changes.push("underline");
      if (s.strikethrough) changes.push("strikethrough");
      if (s.align !== "left") changes.push("align: " + s.align);
      if (s.shadow !== "none") changes.push("shadow: " + s.shadow);
      if (s.transform !== "none") changes.push("transform: " + s.transform);
      if (s.letterSpacing !== 0) changes.push("letterSpacing: " + s.letterSpacing + "px");
      if (s.lineHeight !== 1.4) changes.push("lineHeight: " + s.lineHeight);
      changes.push("color: " + s.color);
      if (s.background !== "transparent") changes.push("background: " + s.background);
      if (sourceNote) changes.push(sourceNote);
      var note = "[" + pathname + " → " + section + " → <" + tag + ">] \"" + text + '" — ' + changes.join(", ");
      var styleOnlyNote = "[" + pathname + " → " + section + " → <" + tag + ">] estilo: " + changes.join(", ");

      var styleChanged = JSON.stringify(s) !== JSON.stringify(initialStyle);

      // Clipboard note stays as a universal audit trail/fallback regardless of
      // whether the writes below succeed.
      navigator.clipboard && navigator.clipboard.writeText(textChanged ? note : styleOnlyNote).catch(function () {});

      fetch(SERVER_ORIGIN + "/api/edit-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: PROJECT_PATH,
          path: pathname,
          section: section,
          tag: tag,
          text: text,
          originalText: originalText,
          textChanged: textChanged,
          style: s,
          sourceNote: sourceNote,
        }),
      }).catch(function () {});

      if (textChanged || styleChanged) {
        showToast("Aplicando cambios al código…");
        var textTask = textChanged
          ? fetch(SERVER_ORIGIN + "/api/apply-text", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectPath: PROJECT_PATH, originalText: originalText, newText: text }),
            })
              .then(function (r) {
                return r.json();
              })
              .catch(function () {
                return { applied: false, reason: "network error" };
              })
          : Promise.resolve(null);

        // Style is matched against whichever text now sits at that node — the
        // just-applied new text if it changed, otherwise the original.
        var styleTask = styleChanged
          ? textTask.then(function (textResult) {
              var matchAgainst = textResult && textResult.applied ? text : originalText;
              return fetch(SERVER_ORIGIN + "/api/apply-style", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectPath: PROJECT_PATH, originalText: matchAgainst, cssStyle: toCssStyle(s) }),
              })
                .then(function (r) {
                  return r.json();
                })
                .catch(function () {
                  return { applied: false, reason: "network error" };
                });
            })
          : Promise.resolve(null);

        Promise.all([textTask, styleTask]).then(function (results) {
          var textResult = results[0];
          var styleResult = results[1];
          var parts = [];
          if (textResult) {
            parts.push(textResult.applied ? "texto → " + textResult.file : "texto ⚠ " + textResult.reason);
          }
          if (styleResult) {
            parts.push(styleResult.applied ? "estilo → " + styleResult.file : "estilo ⚠ " + styleResult.reason);
          }
          var ok = (!textResult || textResult.applied) && (!styleResult || styleResult.applied);
          showToast((ok ? "✓ " : "⚠ ") + parts.join(" · ") + " — refrescá para confirmar", 6000);
        });
      } else {
        showToast("Guardado en historial ✓ " + note);
      }
    }
    if (el) el.contentEditable = "false";
    editingEl = null;
    sourceNote = null;
    history = [];
    future = [];
    isEditing = false;
    barOpen = false;
    style = null;
    renderToggle();
    renderToolbar();
  }

  // ---------------------------------------------------------------------
  // Global listeners
  // ---------------------------------------------------------------------
  document.addEventListener(
    "mousemove",
    function (e) {
      if (!active || editingEl) return;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || !isTextElement(el)) {
        hoverEl = null;
        outlineBox.style.opacity = "0";
        return;
      }
      hoverEl = el;
      var rect = el.getBoundingClientRect();
      outlineBox.style.opacity = "1";
      outlineBox.style.top = rect.top + window.scrollY + "px";
      outlineBox.style.left = rect.left + window.scrollX + "px";
      outlineBox.style.width = rect.width + "px";
      outlineBox.style.height = rect.height + "px";
    },
    true
  );

  document.addEventListener(
    "click",
    function (e) {
      if (!active) return;
      var target = e.target;
      if (target.closest("[" + UI_MARKER + "]")) return;

      if (editingEl) {
        var sel = window.getSelection();
        var mid = sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
        var selectingInside = sel && !sel.isCollapsed && mid && editingEl.contains(mid.nodeType === 1 ? mid : mid.parentNode);
        if (selectingInside) return; // click just ended a text selection (drag or select-all), keep editing open
        if (!editingEl.contains(target)) closeEditor(true);
        return;
      }

      var el = hoverEl;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      openEditor(el);
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if (e.key === "Escape" && editingEl) closeEditor(true);
      // Ctrl+Z left to the browser's native contentEditable undo for text.
      // Style undo/redo only via the ↺/↻ toolbar buttons.
    },
    true
  );

  document.addEventListener("DOMContentLoaded", mount);
  if (document.readyState !== "loading") mount();

  function mount() {
    document.body.appendChild(outlineBox);
    document.body.appendChild(toggleBtn);
    document.body.appendChild(toastBox);
  }
})();
