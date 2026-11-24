export function color(value: any) {
  const raw = value?.rgb;
  return typeof raw === "string" &&
    /^(#[a-f0-9]{3,8}|rgba?\([\d., %]+\)|[a-z]+)$/i.test(raw)
    ? raw
    : undefined;
}

export function textCss(style: any) {
  return [
    style?.ff ? "font-family:" + String(style.ff).replace(/[;"<>]/g, "") : "",
    style?.fs ? "font-size:" + Number(style.fs) + "pt" : "",
    style?.bl === 1 ? "font-weight:bold" : "",
    style?.it === 1 ? "font-style:italic" : "",
    color(style?.cl) ? "color:" + color(style.cl) : "",
    color(style?.bg) ? "background-color:" + color(style.bg) : "",
    style?.ul?.s || style?.st?.s
      ? "text-decoration:" +
        [
          style.ul?.s ? "underline" : "",
          style.st?.s ? "line-through" : "",
        ].join(" ")
      : "",
  ]
    .filter(Boolean)
    .join(";");
}

export function number(v: any, fallback = 0) {
  const n = Number(v?.v ?? v);
  return Number.isFinite(n) ? n : fallback;
}
