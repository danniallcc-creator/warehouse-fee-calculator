// ===== URL Parameter Auto-fill =====
(function loadFromUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const fieldMap = {
        l: 'dimLength', w: 'dimWidth', h: 'dimHeight', wt: 'grossWeight',
        name: 'productName', qty: 'qty', days: 'storageDays', rate: 'freightRate'
    };
    let hasDims = false;
    for (const [param, elId] of Object.entries(fieldMap)) {
        if (params.has(param)) {
            document.getElementById(elId).value = params.get(param);
            if (['l','w','h','wt'].includes(param)) hasDims = true;
        }
    }
    if (params.has('wh')) {
        const wh = document.getElementById('warehouse');
        if (wh.querySelector('option[value="' + params.get('wh') + '"]')) wh.value = params.get('wh');
    }
    // Auto-calculate if dimensions came from URL params (bookmarklet)
    if (hasDims) {
        setTimeout(function() {
            ['dimLength','dimWidth','dimHeight','grossWeight'].forEach(function(id) {
                document.getElementById(id).classList.add('auto-filled');
            });
            calculate();
        }, 300);
    }
})();

// ===== Toggle Advanced Section =====
function toggleAdvancedSection() {
    var section = document.getElementById('advancedSection');
    var toggle = document.getElementById('toggleAdvanced');
    section.classList.toggle('show');
    toggle.textContent = section.classList.contains('show')
        ? '\u25bc \u6536\u8d77\u9ad8\u7ea7\u9009\u9879'
        : '\u25b6 \u9ad8\u7ea7\u9009\u9879\uff08\u5e93\u9f84\u3001\u5934\u7a0b\u8d39\u7387\uff09';
}

// ===== CORS Proxy Fetch =====
var CORS_PROXIES = [
    function(url) { return 'https://corsproxy.io/?' + encodeURIComponent(url); },
    function(url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); },
    function(url) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url); }
];

function showFetchStatus(msg, type) {
    var el = document.getElementById('fetchStatus');
    el.innerHTML = msg;
    el.className = 'fetch-status ' + type;
}

function extractFromHtml(htmlText) {
    var result = { length: null, width: null, height: null, weight: null, name: null };

    // Product name from title/og:title
    var titleMatch = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
        result.name = titleMatch[1].replace(/\s*\|.*$/i, '').replace(/\s*-.*$/i, '').trim();
    }
    var ogMatch = htmlText.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
    if (ogMatch) result.name = ogMatch[1].trim();

    // Search for dimension patterns: LxWxH
    var dimPats = [
        // [PRIMARY] Alibaba JSON data: "attribute":"Single package size","value":"55.2X26.7X7.8 cm"
        /Single\s+package\s+size[^}]*?value[^:]*:\s*["'](\d+(?:\.\d+)?\s*[xX\u00d7*]\s*\d+(?:\.\d+)?\s*[xX\u00d7*]\s*\d+(?:\.\d+)?\s*(?:cm|CM)?)/i,
        // [PRIMARY] Alibaba DOM: title="Single package size" → adjacent title="120X70X24 cm"
        /Single\s+package\s+size[^"]*"[^>]*>.*?title="([^"]+)"/i,
        // Generic: label containing "package size" followed by value
        /(?:Package\s+size|Carton\s+size)[^:]*[:\s]*([^<"\n]+)/i,
        /(?:Dimension|Size|Measurement)[^:]*[:\s]*([^<"\n]*\d+\s*[xX\u00d7*]\s*\d+\s*[xX\u00d7*]\s*\d+[^<"\n]*)/i
    ];

    for (var i = 0; i < dimPats.length; i++) {
        var m = htmlText.match(dimPats[i]);
        if (m) {
            var val = m[1].trim();
            var dm = val.match(/(\d+(?:\.\d+)?)\s*[xX\u00d7*]\s*(\d+(?:\.\d+)?)\s*[xX\u00d7*]\s*(\d+(?:\.\d+)?)\s*(?:cm|CM)?/i);
            if (dm) {
                var vals = [parseFloat(dm[1]), parseFloat(dm[2]), parseFloat(dm[3])];
                vals.sort(function(a,b){return b-a});
                result.length = vals[0]; result.width = vals[1]; result.height = vals[2];
                break;
            }
        }
    }

    // Fallback: any LxWxH cm pattern
    if (!result.length) {
        var allDims = htmlText.match(/(\d+(?:\.\d+)?)\s*[xX\u00d7*]\s*(\d+(?:\.\d+)?)\s*[xX\u00d7*]\s*(\d+(?:\.\d+)?)\s*(?:cm|CM)/g);
        if (allDims) {
            for (var j = 0; j < allDims.length; j++) {
                var dm2 = allDims[j].match(/(\d+(?:\.\d+)?)\s*[xX\u00d7*]\s*(\d+(?:\.\d+)?)\s*[xX\u00d7*]\s*(\d+(?:\.\d+)?)/);
                if (dm2) {
                    var v2 = [parseFloat(dm2[1]), parseFloat(dm2[2]), parseFloat(dm2[3])];
                    if (v2.every(function(x){return x > 0.5 && x < 500})) {
                        v2.sort(function(a,b){return b-a});
                        result.length = v2[0]; result.width = v2[1]; result.height = v2[2];
                        break;
                    }
                }
            }
        }
    }

    // Search for weight - multiple strategies for Alibaba pages
    var weightPats = [
        // [PRIMARY] Alibaba JSON data: "attribute":"Single gross weight","value":"1.843 kg"
        /Single\s+gross\s+weight[^}]*?value[^:]*:\s*["'](\d+(?:\.\d+)?)\s*kg/i,
        // [PRIMARY] Alibaba DOM: title="Single gross weight" → adjacent title="XX.XXX kg"
        /Single\s+gross\s+weight[^"]*"[^>]*>.*?title="(\d+(?:\.\d+)?)\s*kg"/i,
        // Alibaba specific: title="Single gross weight" followed by title="XX.XXX kg"
        /Single\s+gross\s+weight[^"]*"[^"]*"[^"]*title="(\d+(?:\.\d+)?)\s*kg"/i,
        // Alibaba specific: gross weight in adjacent title attribute
        /(?:gross\s+weight|Gross\s+weight)[^"]*"[^>]*>[^<]*<[^>]*title="(\d+(?:\.\d+)?)\s*kg"/i,
        // Generic: "Single gross weight: XX kg" or "Gross weight: XX kg"
        /(?:Single\s+gross\s+weight|Gross\s+weight|Total\s+weight|Package\s+weight)[^:]*[:\s]*([^<"\n]*\d+(?:\.\d+)?\s*kg)/i,
        // Generic: "Weight: XX kg" or "WEIGHT: XX kg"
        /(?:Weight|WEIGHT)[^:]*[:\s]*([^<"\n]*\d+(?:\.\d+)?\s*kg)/i,
        // title attribute with kg value (Alibaba format)
        /title="(\d+\.\d{1,3})\s*kg"/i,
        // Any "XX.XX kg" near weight/gross keywords
        /(?:weight|gross|brutto)[^<]{0,50}(\d+(?:\.\d+)?)\s*kg/i
    ];

    for (var k = 0; k < weightPats.length; k++) {
        var wm = htmlText.match(weightPats[k]);
        if (wm) {
            var wn = wm[1].match(/(\d+(?:\.\d+)?)/);
            if (wn) {
                var w = parseFloat(wn[1]);
                if (w > 0.01 && w < 500) { result.weight = w; break; }
            }
        }
    }

    // Fallback: any XX.XX kg
    if (!result.weight) {
        var kgMatches = htmlText.match(/(\d+\.\d{1,3})\s*kg/gi);
        if (kgMatches) {
            for (var l = 0; l < kgMatches.length; l++) {
                var wm2 = kgMatches[l].match(/(\d+\.\d+)/);
                if (wm2) {
                    var w2 = parseFloat(wm2[1]);
                    if (w2 > 0.5 && w2 < 200) { result.weight = w2; break; }
                }
            }
        }
    }

    return result;
}

async function fetchProductData() {
    var linkInput = document.getElementById('productLink');
    var link = linkInput.value.trim();
    var btn = document.getElementById('btnFetch');

    if (!link) {
        showFetchStatus('\u8bf7\u8f93\u5165\u5546\u54c1\u94fe\u63a5', 'error');
        return;
    }

    if (link.indexOf('alibaba.com') === -1 && link.indexOf('1688.com') === -1) {
        showFetchStatus('\u4ec5\u652f\u6301\u963f\u91cc\u56fd\u9645\u7ad9 (alibaba.com) \u6216 1688 (1688.com)', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = '\u6293\u53d6\u4e2d...';
    btn.classList.add('fetching');
    showFetchStatus('\u6b63\u5728\u83b7\u53d6\u5546\u54c1\u4fe1\u606f\uff0c\u8bf7\u7a0d\u5019\uff08\u7ea65-10\u79d2\uff09...', 'loading');

    var pageText = '';
    var success = false;

    for (var i = 0; i < CORS_PROXIES.length; i++) {
        try {
            var proxyUrl = CORS_PROXIES[i](link);
            var resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
            if (resp.ok) {
                pageText = await resp.text();
                if (pageText.length > 1000) {
                    success = true;
                    break;
                }
            }
        } catch (e) {
            continue;
        }
    }

    btn.disabled = false;
    btn.textContent = '\u83b7\u53d6\u5546\u54c1\u4fe1\u606f';
    btn.classList.remove('fetching');

    if (!success || !pageText) {
        showFetchStatus(
            '<strong>\u81ea\u52a8\u6293\u53d6\u5931\u8d25</strong>\uff08\u963f\u91cc\u5df4\u5df4\u7684\u53cd\u722c\u866b\u4fdd\u62a4\uff09<br>' +
            '\u8bf7\u4f7f\u7528\u4ee5\u4e0b\u65b9\u5f0f\uff1a<br>' +
            '\u2460 \u4f7f\u7528\u4e0a\u65b9 <strong>\u4e66\u7b7e\u5de5\u5177</strong>\uff1a\u62d6\u5230\u4e66\u7b7e\u680f\uff0c\u5728\u5546\u54c1\u9875\u70b9\u51fb\u5373\u53ef<br>' +
            '\u2461 \u624b\u52a8\u5728\u4e0b\u65b9\u8f93\u5165\u5c3a\u5bf8\u548c\u91cd\u91cf\u4fe1\u606f',
            'error'
        );
        return;
    }

    var data = extractFromHtml(pageText);
    autoFillFields(data);
}

function autoFillFields(data) {
    var mapping = {
        length: 'dimLength', width: 'dimWidth',
        height: 'dimHeight', weight: 'grossWeight'
    };
    var labels = { length: '\u957f', width: '\u5bbd', height: '\u9ad8', weight: '\u91cd\u91cf' };
    var units = { length: 'cm', width: 'cm', height: 'cm', weight: 'kg' };
    var filled = [];

    for (var key in mapping) {
        if (data[key] && data[key] > 0) {
            var el = document.getElementById(mapping[key]);
            el.value = data[key];
            el.classList.add('auto-filled');
            setTimeout(function(e) { return function() { e.classList.remove('auto-filled'); }; }(el), 3000);
            filled.push(labels[key] + ': ' + data[key] + ' ' + units[key]);
        }
    }

    if (data.name) {
        document.getElementById('productName').value = data.name.substring(0, 80);
    }

    // Check what's missing
    var missing = [];
    if (!data.length) missing.push('尺寸(长×宽×高)');
    if (!data.weight) missing.push('重量(kg)');

    if (filled.length >= 4) {
        showFetchStatus(
            '<strong>自动填充成功！</strong> ' + filled.join(' | ') +
            '<br>请选择仓库后点击「立即测算」。',
            'success'
        );
    } else if (filled.length > 0) {
        showFetchStatus(
            '<strong>部分填充成功：</strong> ' + filled.join(' | ') +
            '<br><span style="color:#fcd34d">缺少：' + missing.join('、') + '</span>，请手动补充。',
            'error'
        );
    } else {
        showFetchStatus(
            '已打开页面但未识别到尺寸和重量信息，请手动填写。<br>' +
            '提示：也可使用书签工具在商品页一键提取（更可靠）。',
            'error'
        );
    }
}

