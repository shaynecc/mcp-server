"""模板申请字段与占位符的本地结构校验。"""

import re

from .client import failure
from .models import TemplateApplication
from .observability import observe_call
from .protocol import SmsAPIError

_VARIABLE = re.compile(r"\$\{([^{}]*)\}")
_VARIABLE_NAME = re.compile(r"[A-Za-z0-9_]+")


def template_variables(content: str) -> list[str]:
    """template_variables 按短信原生占位符语法提取变量，不改写正文或变量名。"""
    names = [match[1] for match in _VARIABLE.finditer(content)]
    if "${" in _VARIABLE.sub("", content) or any(_VARIABLE_NAME.fullmatch(name) is None for name in names):
        raise SmsAPIError(failure(
            "ApplySmsTemplateV2ForAgent", "invalid_template_variables", "请使用完整的 ${变量名}，名称仅含英文、数字或下划线"
        ))
    return names


def validate_template_application(request: TemplateApplication) -> None:
    """validate_template_application 校验页面字段的一致性，审核和动态业务规则仍由短信服务决定。"""
    with observe_call("form", "template", path="validate") as observation:
        try:
            names = template_variables(request.content)
            definitions = request.template_params or []
            declared = {item.name: item.param_type for item in definitions}
            if not request.signatures or any(not item for item in request.signatures):
                raise SmsAPIError(failure("ApplySmsTemplateV2ForAgent", "signature_required", "请至少选择一个短信签名"))
            if len(declared) != len(definitions) or set(names) != set(declared):
                raise SmsAPIError(failure(
                    "ApplySmsTemplateV2ForAgent", "invalid_template_variables", "正文变量与变量设置必须一一对应，不能重复定义"
                ))
            if request.channel_type == "CN_OTP" and (
                len(names) != 1 or set(declared.values()) != {1} or request.template_traffic_driving
            ):
                raise SmsAPIError(failure(
                    "ApplySmsTemplateV2ForAgent", "invalid_otp_template", "验证码模板需且只能有一个普通变量，不支持引流绑定"
                ))
            if request.short_url_config and request.short_url_config.is_enabled == "1" and request.channel_type != "CN_MKT":
                raise SmsAPIError(failure("ApplySmsTemplateV2ForAgent", "invalid_short_link", "平台短链只适用于营销模板"))
            traffic_names = {name for name, kind in declared.items() if kind in (2, 3)}
            groups = request.template_traffic_driving or []
            if traffic_names and not groups:
                raise SmsAPIError(failure("ApplySmsTemplateV2ForAgent", "traffic_binding_required", "请为链接或电话号码变量选择已报备资源"))
            for group in groups:
                if len({item.name for item in group}) != len(group) or {item.name for item in group} != traffic_names:
                    raise SmsAPIError(failure("ApplySmsTemplateV2ForAgent", "invalid_traffic_binding", "每组引流绑定需完整覆盖对应变量且不重复"))
                if any(declared[item.name] != item.param_type for item in group):
                    raise SmsAPIError(failure("ApplySmsTemplateV2ForAgent", "invalid_traffic_binding", "引流绑定类型与变量类型不一致"))
        except SmsAPIError as exc:
            observation.record(exc.result)
            raise
        observation.record({"success": True})
