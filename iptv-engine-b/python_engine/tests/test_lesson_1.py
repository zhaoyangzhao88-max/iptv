import os
def test_workspace_structure():
    """测试工程目录和核心蓝图文件是否被正确创建"""
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    assert os.path.exists(os.path.join(root_dir, "MASTER_PLAN.md")), "MASTER_PLAN.md 缺失！"
    assert os.path.exists(os.path.join(root_dir, "python_engine", "src")), "Python src 目录缺失！"
    assert os.path.exists(os.path.join(root_dir, "node_api", "src")), "Node src 目录缺失！"

def test_pytest_framework():
    """测试 pytest 框架是否正常运转"""
    assert True, "TDD 框架启动成功"
