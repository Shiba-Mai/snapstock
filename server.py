#!/usr/bin/env python3
import base64, io, json, os, re, tempfile, threading, hashlib
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from PIL import Image, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024
_ocr = None
_ocr_lock = threading.Lock()
_engine_name = None

def init_ocr():
    global _ocr, _engine_name
    if _ocr is not None:
        return _ocr
    with _ocr_lock:
        if _ocr is not None:
            return _ocr
        from paddleocr import PaddleOCR
        engine = os.environ.get("SNAPSTOCK_OCR_ENGINE", "paddle")
        kwargs = dict(
            lang="japan",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
        try:
            _ocr = PaddleOCR(engine=engine, **kwargs)
            _engine_name = f"PaddleOCR ({engine})"
        except TypeError:
            _ocr = PaddleOCR(**kwargs)
            _engine_name = "PaddleOCR"
        return _ocr

def decode_image(data_url):
    if not data_url or "," not in data_url:
        raise ValueError("画像データがありません")
    raw=base64.b64decode(data_url.split(",",1)[1])
    img=Image.open(io.BytesIO(raw)).convert("RGB")
    w,h=img.size
    # Crop a small outer margin to reduce desk/background noise.
    mx,my=int(w*0.025),int(h*0.02)
    if w>400 and h>400:
        img=img.crop((mx,my,w-mx,h-my))
    gray=ImageOps.grayscale(img)
    auto=ImageOps.autocontrast(gray,cutoff=1)
    strong=ImageEnhance.Contrast(auto).enhance(1.45)

    variants=[]
    for im in (img, auto.convert("RGB"), strong.convert("RGB")):
        iw,ih=im.size
        if min(iw,ih)<1400:
            scale=min(2.2,1400/max(1,min(iw,ih)))
            nw,nh=int(iw*scale),int(ih*scale)
            if max(nw,nh)<=4500:
                im=im.resize((nw,nh),Image.Resampling.LANCZOS)
        variants.append(im)
    return variants

def get_json(res):
    try:
        j = res.json
        if callable(j):
            j = j()
        if isinstance(j, str):
            j = json.loads(j)
        return j if isinstance(j, dict) else {}
    except Exception:
        return {}

def extract_rows(result):
    rows, confs = [], []
    for res in result:
        d = get_json(res)
        payload = d.get("res", d)
        if not isinstance(payload, dict):
            continue
        texts = payload.get("rec_texts") or []
        scores = payload.get("rec_scores") or []
        boxes = payload.get("rec_boxes") or []
        if not texts and isinstance(payload.get("overall_ocr_res"), dict):
            sub = payload["overall_ocr_res"]
            texts = sub.get("rec_texts") or []
            scores = sub.get("rec_scores") or []
            boxes = sub.get("rec_boxes") or []

        for i, text in enumerate(texts):
            text = str(text).strip()
            if not text:
                continue
            score = float(scores[i]) if i < len(scores) else 0.0
            confs.append(score)
            if i < len(boxes) and len(boxes[i]) >= 4:
                x1,y1,x2,y2 = [float(v) for v in boxes[i][:4]]
                rows.append({"text":text,"score":score,"y":(y1+y2)/2,"left":x1,"height":max(1,y2-y1)})
            else:
                rows.append({"text":text,"score":score,"y":len(rows)*30,"left":0,"height":20})

    rows.sort(key=lambda r:(r["y"],r["left"]))
    groups=[]
    for row in rows:
        placed=False
        for g in reversed(groups[-4:]):
            threshold=max(9.0,min(28.0,(g["height"]+row["height"])*0.45))
            if abs(row["y"]-g["y"])<=threshold:
                g["parts"].append(row)
                n=len(g["parts"])
                g["y"]=(g["y"]*(n-1)+row["y"])/n
                g["height"]=max(g["height"],row["height"])
                placed=True
                break
        if not placed:
            groups.append({"y":row["y"],"height":row["height"],"parts":[row]})

    lines=[]
    for g in sorted(groups,key=lambda x:x["y"]):
        line=" ".join(p["text"] for p in sorted(g["parts"],key=lambda x:x["left"])).strip()
        if line:
            lines.append(line)
    return lines, confs

def detect_total(lines):
    candidates=[]
    trans=str.maketrans("０１２３４５６７８９，","0123456789,")
    for idx,line in enumerate(lines):
        text=str(line).strip()

        # Reject count rows and tax/subtotal rows.
        if re.search(r"(お買上点数|お買い上げ点数|商品点数|点数|レジ点数|件数)",text):
            continue
        if re.search(r"(小計|税合計|税額|外税|内税|対象額|課税対象|免税)",text):
            continue

        priority=0
        if re.search(r"(総合計|総額|お支払額|お支払い額|ご請求額|支払合計)",text):
            priority=5
        elif re.search(r"(^|\s)合計(\s|$)|合計金額",text):
            priority=4
        elif re.search(r"(税込合計|税込金額)",text):
            priority=4
        elif re.search(r"(お買上金額|お買い上げ金額)",text):
            priority=3
        else:
            continue

        vals=[]
        for raw in re.findall(r"[¥￥]?\s*([0-9０-９][0-9０-９,，]{1,8})",text):
            try:
                v=int(raw.translate(trans).replace(",",""))
                if 50 <= v <= 500000:
                    vals.append(v)
            except:
                pass
        for v in vals:
            candidates.append((priority,idx,v))

    if not candidates:
        return None

    # Higher-priority label, lower receipt position, larger amount.
    candidates.sort(key=lambda x:(x[0],x[1],x[2]), reverse=True)
    return candidates[0][2]

@app.after_request
def no_cache(response):
    response.headers["Cache-Control"]="no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"]="no-cache"
    response.headers["Expires"]="0"
    return response

@app.get("/")
def index():
    return send_from_directory(ROOT,"index.html")


@app.get("/api/config")
def public_config():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    return jsonify({
        "ok": bool(url and key),
        "supabase_url": url,
        "supabase_publishable_key": key,
    })

@app.get("/api/status")
def status():
    return jsonify({"ok":True,"version":"web-v23","engine":_engine_name or "PaddleOCR (未ロード)"})

@app.post("/api/ocr")
def ocr_api():
    tmp=None
    try:
        body=request.get_json(force=True)
        request_id=str(body.get("request_id") or request.args.get("request_id") or "")
        image_data=body.get("image") or ""
        fingerprint=hashlib.sha256(image_data.encode("utf-8")).hexdigest()[:12]
        variants=decode_image(image_data)
        ocr=init_ocr()
        candidates=[]
        temp_paths=[]
        # FAST PATH: run one good preprocessed image first.
        first_indexes=[1] if len(variants)>1 else [0]
        for idx in first_indexes:
            img=variants[idx]
            fd,path=tempfile.mkstemp(suffix=f"_{idx}.jpg"); os.close(fd); temp_paths.append(path)
            img.save(path,"JPEG",quality=92)
            result=ocr.predict(path)
            lines0,confs0=extract_rows(result)
            avg0=sum(confs0)/len(confs0) if confs0 else 0
            score=avg0 + min(len(lines0),40)*0.003
            candidates.append((score,lines0,confs0))

        # Retry extra variants only when the first pass looks unreliable.
        best_score,best_lines,best_confs=candidates[0]
        best_avg=sum(best_confs)/len(best_confs) if best_confs else 0
        if best_avg < 0.84 or len(best_lines) < 6:
            for idx in [0,2]:
                if idx>=len(variants) or idx in first_indexes: continue
                img=variants[idx]
                fd,path=tempfile.mkstemp(suffix=f"_{idx}.jpg"); os.close(fd); temp_paths.append(path)
                img.save(path,"JPEG",quality=92)
                result=ocr.predict(path)
                lines0,confs0=extract_rows(result)
                avg0=sum(confs0)/len(confs0) if confs0 else 0
                score=avg0 + min(len(lines0),40)*0.003
                candidates.append((score,lines0,confs0))
        candidates.sort(key=lambda x:x[0],reverse=True)
        _,lines,confs=candidates[0]
        for path in temp_paths:
            try: os.remove(path)
            except: pass
        if not lines:
            raise RuntimeError("文字を検出できませんでした。レシートを正面から明るく撮影してください。")
        avg=sum(confs)/len(confs) if confs else None
        return jsonify({
            "ok":True,
            "engine":_engine_name or "PaddleOCR",
            "lines":lines,
            "average_confidence":avg,
            "receipt_total":detect_total(lines),
            "request_id":request_id,
            "image_fingerprint":fingerprint
        })
    except Exception as e:
        app.logger.exception("OCR failed")
        return jsonify({"ok":False,"error":f"{type(e).__name__}: {e}"}),500
    finally:
        if tmp:
            try: os.remove(tmp)
            except: pass

@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(ROOT,path)

if __name__=="__main__":
    print("SnapStock v18: http://127.0.0.1:8770")
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "3000")), debug=False, threaded=True)
