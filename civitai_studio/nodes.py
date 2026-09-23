"""Civitai Studio 功能节点(轻量,与本地库数据打通)."""

import re

from . import local_index


class CivitaiTriggerWords:
    """选择本地已关联的 LoRA,输出其 Civitai 触发词(+ 手动补充词)."""

    @classmethod
    def INPUT_TYPES(cls):
        idx = local_index.scan()
        options = []
        for m in idx["models"]:
            if m["category"] != "loras":
                continue
            civ = m.get("civitai") or {}
            if civ.get("trained_words"):
                options.append(m["id"])
        if not options:
            options = ["(no loras with trigger words - associate one first)"]
        return {"required": {
            "lora": (options,),
            "extra_words": ("STRING", {"default": "", "multiline": False}),
        }}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("trigger_words",)
    FUNCTION = "run"
    CATEGORY = "Civitai Studio"

    def run(self, lora, extra_words):
        words = []
        item = local_index.scan().get("by_id", {}).get(str(lora))
        if item:
            meta = item.get("civitai") or {}
            words = meta.get("trained_words") or []
        extra = [w.strip() for w in re.split(r"[,，]", extra_words or "") if w.strip()]
        return (", ".join(words + extra),)


NODE_CLASS_MAPPINGS = {
    "CivitaiTriggerWords": CivitaiTriggerWords,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CivitaiTriggerWords": "Civitai 触发词 (Trigger Words)",
}
