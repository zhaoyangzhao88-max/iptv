from python_engine.src.merger import validate_final_json_data

def test_json_schema_industrial_validation_success():
    """测试强校验器：百分之百合规、干净的数据必须秒速放行"""
    valid_data_sample = [
        {
            "name": "CCTV-1",
            "group": "央视频道",
            "urls": ["http://live.com/1.m3u8"],
            "delay_ms": 10
        },
        {
            "name": "浙江卫视",
            "group": "卫视频道",
            "urls": ["http://live.com/2.m3u8"],
            "delay_ms": 85,
            "logo": "http://logo.com/zj.png"
        }
    ]
    assert validate_final_json_data(valid_data_sample) is True

def test_json_schema_industrial_validation_failures():
    """测试强校验器：任何违背 Pydantic 物理契约的脏数据必须在微秒级被探测到并秒级拦截熔断"""
    # 场景 1：缺失绝对必填字段 "name"
    invalid_data_no_name = [
        {
            "group": "央视频道",
            "urls": ["http://live.com/1.m3u8"],
            "delay_ms": 10
        }
    ]
    assert validate_final_json_data(invalid_data_no_name) is False

    # 场景 2：urls 格式发生严重崩溃 (契约规定必须是数组 List[str]，结果错写为单个 string 链接)
    invalid_data_urls_type = [
        {
            "name": "CCTV-1",
            "group": "央视频道",
            "urls": "http://live.com/1.m3u8",  # 脏数据
            "delay_ms": 10
        }
    ]
    assert validate_final_json_data(invalid_data_urls_type) is False

    # 场景 3：delay_ms 物理类型发生混乱 (契约规定必须为整型，结果被错写为 string 类型的 "fast")
    invalid_data_delay_type = [
        {
            "name": "CCTV-1",
            "group": "央视频道",
            "urls": ["http://live.com/1.m3u8"],
            "delay_ms": "fast"  # 脏数据
        }
    ]
    assert validate_final_json_data(invalid_data_delay_type) is False
