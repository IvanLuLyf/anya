(function () {
    function Anya() {

    }

    const snippets = {};
    const PREFIX = "anya-"
    const REG_EXP_TAG = /<([^>]+)>([^<]*){{\s*([\w.]+)\s*}}([^<]*)<\/([^>]+)>/g,
        REG_EXP_EVT = /@(\w+)="([^"]+)"/g,
        REG_EXP_ATTR = /:(\w+)="([^"]+)"/g,
        REG_EXP_BIND = new RegExp(`\\${PREFIX}bind='([^']+)'`);

    function htmlEncode(text) {
        const encodeMap = {'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'};
        return text ? text.replace(/[&<>'"]/g, char => encodeMap[char]) : text;
    }

    function loadSnippet(name) {
        return new Promise((resolve) => {
            if (snippets[name]) return resolve();
            fetch(`./snippets/${name}.html`).then((res) => res.text()).then((html) => {
                const templateTag = html.match(/<template>([\s\S]*?)<\/template>/);
                const scriptTag = html.match(/<script>([\s\S]*?)<\/script>/);
                const styleTag = html.match(/<style>([\s\S]*?)<\/style>/);
                snippets[name] = {
                    template: templateTag[1].trim().replace(REG_EXP_TAG, (match, openTag, before, bindKey, after, closeTag) => {
                        return `<${openTag} :textContent="${before}{{${bindKey}}}${after}"></${closeTag}>`;
                    }).replace(/<([^>]+)>/g, (match, content) => {
                        const events = Array.from(content.matchAll(REG_EXP_EVT)).map(([_, event, method]) => `${event}:${method}`).join(';');
                        const binding = {};
                        content = content.replace(REG_EXP_EVT, '').replace(REG_EXP_ATTR, (_, attr, bindKey) => {
                            binding[attr] = bindKey.includes('{{') ? bindKey : `{{${bindKey}}}`;
                            return '';
                        }).replace(REG_EXP_BIND, (match, bindStr) => {
                            if (bindStr) Object.assign(binding, JSON.parse(bindStr));
                            return '';
                        });
                        const evtAttr = events ? ` ${PREFIX}event="${events}"` : '';
                        const bindAttr = Object.keys(binding).length ? `${PREFIX}bind="${htmlEncode(JSON.stringify(binding))}"` : ''
                        return `<${content}${evtAttr}${bindAttr}>`;
                    }),
                };
                Anya.defineSnippet = (obj) => {
                    snippets[name].snippet = obj || {};
                    delete Anya.defineSnippet;
                    resolve();
                };
                const snippet = new Function('Anya', 'defineSnippet', scriptTag[1]);
                snippet.call(Anya, Anya, Anya.defineSnippet);
                if (styleTag) {
                    const style = document.createElement('style');
                    style.appendChild(document.createTextNode(styleTag[1]));
                    document.head.appendChild(style);
                }
            });
        });
    }

    function createReactive(o, $update, path = "") {
        return new Proxy(o, {
            get(target, prop) {
                const value = target[prop];
                if (typeof value === 'object' && value !== null) return createReactive(value, $update, path ? `${path}.${prop}` : prop);
                return value;
            },
            set: (target, prop, val) => {
                target[prop] = val;
                $update(path ? `${path}.${prop}` : prop);
                return true;
            },
        })
    }

    function createSnippet(name, $el) {
        $el.innerHTML = snippets[name].template;
        const comp = snippets[name].snippet;
        const _data = typeof comp.data === "function" ? (comp.data($el.dataset || {}) || {}) : {};
        const methods = comp.methods || {};
        const $binding = new Map();
        const $update = (key) => {
            const $nodes = $binding.get(key) || [];
            $nodes.forEach(($n) => {
                const bindingData = JSON.parse($n.getAttribute(`${PREFIX}bind`));
                Object.entries(bindingData).forEach(([attr, exp]) => {
                    $n[attr] = exp.replace(/{{\s*([\w.]+)\s*}}/g, (_, bindKey) => {
                        return bindKey.trim().split('.').reduce((val, key) => val[key] ?? '', _data);
                    });
                });
            });
        }
        const $data = createReactive(_data, $update);
        const $snippet = {$data, $el};
        Object.entries(methods).forEach(([name, func]) => {
            $snippet[name] = func.bind($snippet);
        });
        $el.querySelectorAll(`[${PREFIX}model]`).forEach(($n) => {
            const modelKey = $n.getAttribute(`${PREFIX}model`);
            $n.value = modelKey.split('.').reduce((val, key) => val[key] ?? '', _data);
            $n.addEventListener('input', (e) => {
                const keys = modelKey.split('.');
                const lastKey = keys.pop();
                const target = keys.reduce((val, key) => val[key], $data);
                if (target && lastKey) target[lastKey] = e.target.value;
            });
        });
        $el.querySelectorAll(`[${PREFIX}event]`).forEach(($n) => {
            const evtMap = $n.getAttribute(`${PREFIX}event`).split(';');
            evtMap.forEach((m) => {
                const [type, method] = m.trim().split(':');
                $n.addEventListener(type, (e) => {
                    if (typeof methods[method] === "function") methods[method].call($snippet, e);
                })
            });
        });
        $el.querySelectorAll(`[${PREFIX}bind]`).forEach(($n) => {
            const bindingData = JSON.parse($n.getAttribute(`${PREFIX}bind`));
            Object.entries(bindingData).forEach(([attr, exp]) => {
                $n[attr] = exp.replace(/{{\s*([\w.]+)\s*}}/g, (_, bindKey) => {
                    if (!$binding.has(bindKey)) $binding.set(bindKey, []);
                    $binding.get(bindKey).push($n);
                    return bindKey.trim().split('.').reduce((val, key) => val[key] ?? '', _data);
                });
            });
        });
        if (typeof comp.created === 'function') comp.created.call($snippet);
    }

    const processChildren = (p) => Promise.all(Array.from(p.children).map((c) => processEl(c)))

    function processEl(el) {
        return new Promise((resolve) => {
            const name = el.getAttribute('is');
            if (name) {
                loadSnippet(name).then(() => {
                    createSnippet(name, el);
                    processChildren(el).then(resolve);
                });
                return;
            }
            processChildren(el).then(resolve);
        })
    }

    Anya.mount = (el) => {
        const $el = document.querySelector(el);
        return processEl($el ? $el : document.body);
    }
    window.Anya = Anya;
    window.defineSnippet = (o) => o;
})();