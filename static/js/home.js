/* ── SCAN ─────────────────────────────────────── */
document.getElementById("cameraInput").addEventListener("change", function(e) {
  var file = e.target.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function(ev) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);

      // Sample center 40% crop
      var cx = Math.floor(img.width * 0.3);
      var cy = Math.floor(img.height * 0.3);
      var cw = Math.floor(img.width * 0.4);
      var ch = Math.floor(img.height * 0.4);
      var data = ctx.getImageData(cx, cy, cw, ch).data;

      var r = 0, g = 0, b = 0, n = data.length / 4;
      for (var i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i+1]; b += data[i+2];
      }
      r = Math.round(r/n); g = Math.round(g/n); b = Math.round(b/n);

      var hex = "#" + ("0"+r.toString(16)).slice(-2) +
                      ("0"+g.toString(16)).slice(-2) +
                      ("0"+b.toString(16)).slice(-2);
      hex = hex.toUpperCase();

      var hsv = rgbToHsv(r, g, b);
      var h = hsv[0], s = hsv[1], v = hsv[2];
      var result = classify(h, s, v);

      showResult(result, hex);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r,g,b), min = Math.min(r,g,b);
  var d = max - min, h, s = max === 0 ? 0 : d/max, v = max;
  if (max === min) { h = 0; }
  else {
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6; break;
      case b: h = ((r-g)/d + 4)/6; break;
    }
  }
  return [h*360, s, v];
}

function classify(h, s, v) {
  if (s < 0.15 || v < 0.15) return { state:"CAUTION", ph:"pH unclear", desc:"Low saturation — reposition the label", emoji:"⚠️" };
  if ((h >= 330 || h < 30) && s > 0.3)  return { state:"FRESH",   ph:"pH 1–4",  desc:"Red / Pink — Acidic, food is fresh",            emoji:"✅" };
  if (h >= 270 && h < 330)              return { state:"FRESH",   ph:"pH 5–6",  desc:"Purple — Slightly acidic, food is fresh",       emoji:"✅" };
  if (h >= 200 && h < 270)              return { state:"CAUTION", ph:"pH 7–8",  desc:"Blue — Neutral / slightly basic, consume soon", emoji:"⚠️" };
  if (h >= 90  && h < 200)              return { state:"SPOILED", ph:"pH 9–10", desc:"Green — Basic, spoilage detected",               emoji:"🚫" };
  if (h >= 45  && h < 90)               return { state:"SPOILED", ph:"pH 11+",  desc:"Yellow — Highly basic, do not consume",          emoji:"🚫" };
  return { state:"CAUTION", ph:"pH unclear", desc:"Unable to classify — try rescanning", emoji:"⚠️" };
}

function showResult(result, hex) {
  var panel = document.getElementById("resultPanel");
  document.getElementById("resEmoji").textContent = result.emoji;

  var label = document.getElementById("resLabel");
  label.textContent = result.state;
  label.className = "result-label " + result.state.toLowerCase();

  document.getElementById("resDesc").textContent = result.desc;
  document.getElementById("resSwatch").style.background = hex;
  document.getElementById("resHex").textContent = hex;
  document.getElementById("resPh").textContent = result.ph;

  panel.style.display = "block";
  panel.scrollIntoView({ behavior:"smooth", block:"center" });
}

document.getElementById("scanAgain").addEventListener("click", function() {
  document.getElementById("resultPanel").style.display = "none";
  window.scrollTo({ top: 0, behavior:"smooth" });
});

/* ── ACCORDION ────────────────────────────────── */
document.querySelectorAll(".accordion-header").forEach(function(btn) {
  btn.addEventListener("click", function() {
    var content = btn.nextElementSibling;
    var isOpen  = btn.classList.contains("active");

    document.querySelectorAll(".accordion-header").forEach(function(b) {
      b.classList.remove("active");
      b.nextElementSibling.style.maxHeight = null;
    });

    if (!isOpen) {
      btn.classList.add("active");
      content.style.maxHeight = content.scrollHeight + "px";
    }
  });
});

/* ── SUGGESTION ───────────────────────────────── */
function sendSuggestion() {
  var msg = document.getElementById("suggestionMessage").value.trim();
  if (!msg) { return; }

  fetch("/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg })
  }).then(function(r) { return r.json(); }).then(function(d) {
    document.getElementById("suggestionMessage").value = "";
    var toast = document.getElementById("toast");
    toast.style.display = "block";
    setTimeout(function() { toast.style.display = "none"; }, 3500);
  });
}

/* ── SHARE ────────────────────────────────────── */
function shareProject() {
  var url   = window.location.origin;
  var title = "Antholytix AI – Smart Food Freshness Detection";
  var text  = title + "\n\nA chemistry-based innovation detecting food spoilage through natural anthocyanin indicator colour analysis.\n\n" + url;

  if (navigator.share) {
    navigator.share({ title: title, text: text, url: url });
  } else {
    navigator.clipboard.writeText(text);
    alert("Link copied! You can now paste and share it.");
  }
}

/* ── NAV ACTIVE ───────────────────────────────── */
(function() {
  var links = document.querySelectorAll(".navlinks a");
  var path  = window.location.pathname.split("/").pop() || "home";
  links.forEach(function(a) {
    if (a.getAttribute("href").includes(path)) a.classList.add("active");
  });
})();
