import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  MarkerType,
  EdgeProps,
  getSmoothStepPath,
  Handle,
  Position,
  useReactFlow,
} from 'reactflow';
import {
  Card,
  Button,
  Space,
  Input,
  Select,
  Form,
  Modal,
  Slider,
  Collapse,
  Tag,
  List,
  Popconfirm,
  message,
  Switch,
  InputNumber,
  Tabs,
  Tooltip,
  Divider,
  Empty,
} from 'antd';
import {
  PlusOutlined,
  PlayCircleOutlined,
  StopOutlined,
  SaveOutlined,
  DeleteOutlined,
  ApartmentOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  HourglassOutlined,
  QuestionCircleOutlined,
  BranchOutlined,
  WifiOutlined,
  BulbOutlined,
  SettingOutlined,
  ClockCircleOutlined,
  ThunderboltFilled,
  DatabaseFilled,
  RocketOutlined,
  ExperimentOutlined,
  CopyOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { v4 as uuidv4 } from 'uuid';
import { nodeTypes } from '@/components/WorkflowNodes';
import { anomalyApi, workflowApi, deviceApi, testCaseApi, nodeApi, templateApi } from '@/services/api';
import { useAppStore } from '@/store';
import type {
  AnomalyType,
  AnomalyConfig,
  Workflow as WorkflowType,
  WorkflowNode,
  WorkflowEdge,
  DeviceSimulatorConfig,
  NodeType,
  AnomalyTemplate,
  TemplateCategory,
} from '@/types';

const { Option } = Select;
const { Panel } = Collapse;
const { TextArea } = Input;
const { TabPane } = Tabs;

const CustomEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  selected,
}: EdgeProps) => {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const hasDelay = data?.delay_seconds && data.delay_seconds > 0;
  const hasCondition = data?.condition;

  return (
    <>
      <path
        id={id}
        style={style}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd="url(#arrow)"
      />
      {(hasDelay || hasCondition) && (
        <g transform={`translate(${(sourceX + targetX) / 2 - 12}, ${(sourceY + targetY) / 2 - 12})`}>
          <foreignObject width={24} height={24}>
            <div className="flex items-center justify-center w-full h-full">
              <Tag color={hasDelay ? 'gold' : 'purple'} className="m-0 text-xs p-0 w-5 h-5 flex items-center justify-center rounded-full">
                {hasDelay && <ClockCircleOutlined />}
                {!hasDelay && hasCondition && <QuestionCircleOutlined />}
              </Tag>
            </div>
          </foreignObject>
        </g>
      )}
      {selected && (
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          className="pointer-events-none"
        />
      )}
    </>
  );
};

const edgeTypes = {
  custom: CustomEdge,
};

const WorkflowEditor: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [anomalyTypes, setAnomalyTypes] = useState<AnomalyType[]>([]);
  const [nodeTypesList, setNodeTypesList] = useState<NodeType[]>([]);
  const [templates, setTemplates] = useState<AnomalyTemplate[]>([]);
  const [templateCategories, setTemplateCategories] = useState<TemplateCategory[]>([]);
  const [devices, setDevices] = useState<DeviceSimulatorConfig[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowType[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [isRunning, setIsRunning] = useState<Record<string, boolean>>({});
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDesc, setWorkflowDesc] = useState('');
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [executionMode, setExecutionMode] = useState<'sequential' | 'parallel' | 'mixed'>('sequential');
  const [activeTab, setActiveTab] = useState<'nodes' | 'templates'>('nodes');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [edgeForm] = Form.useForm();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  const setWorkflowsStore = useAppStore((state) => state.setWorkflows);
  const addWorkflowStore = useAppStore((state) => state.addWorkflow);
  const removeWorkflowStore = useAppStore((state) => state.removeWorkflow);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedEdge) {
      edgeForm.setFieldsValue({
        delay_seconds: selectedEdge.data?.delay_seconds || 0,
        condition: selectedEdge.data?.condition || '',
      });
    }
  }, [selectedEdge, edgeForm]);

  const loadData = async () => {
    try {
      const [anomaliesRes, devicesRes, workflowsRes, nodeTypesRes, templatesRes, categoriesRes] = await Promise.all([
        anomalyApi.getTypes(),
        deviceApi.getAll(),
        workflowApi.getAll(),
        nodeApi.getTypes(),
        templateApi.getAll(),
        templateApi.getCategories(),
      ]);
      setAnomalyTypes(anomaliesRes.data);
      setDevices(devicesRes.data);
      setWorkflows(workflowsRes.data);
      setWorkflowsStore(workflowsRes.data);
      setNodeTypesList(nodeTypesRes.data);
      setTemplates(templatesRes.data);
      setTemplateCategories(categoriesRes.data);
    } catch (e) {
      console.error('Failed to load data:', e);
      message.error('加载数据失败');
    }
  };

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: 'custom',
            animated: true,
            style: { stroke: '#64748b', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
            data: {},
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow/type');
      const anomalyType = event.dataTransfer.getData('application/reactflow/anomalyType');
      const deviceId = event.dataTransfer.getData('application/reactflow/deviceId');
      const nodeType = event.dataTransfer.getData('application/reactflow/nodeType');
      const templateData = event.dataTransfer.getData('application/reactflow/template');

      if (!type || !reactFlowWrapper.current || !reactFlowInstance) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      if (templateData) {
        try {
          const template = JSON.parse(templateData);
          loadTemplateToCanvas(template, position);
          return;
        } catch (e) {
          console.error('Failed to parse template:', e);
        }
      }

      const nodeId = uuidv4();
      let newNode: Node;

      if (type === 'device') {
        const device = devices.find((d) => d.device_id === deviceId);
        newNode = {
          id: nodeId,
          type: 'device',
          position,
          data: {
            label: device?.device_id || '设备',
            deviceId: deviceId,
          },
        };
      } else if (type === 'anomaly') {
        const anomaly = anomalyTypes.find((a) => a.name === anomalyType);
        const defaultParams: Record<string, any> = {};
        if (anomaly) {
          Object.entries(anomaly.parameters).forEach(([key, value]) => {
            defaultParams[key] = value.default;
          });
        }
        newNode = {
          id: nodeId,
          type: 'anomaly',
          position,
          data: {
            label: anomaly?.description || '异常注入',
            anomalyType: anomalyType,
            config: {
              probability: 1.0,
            },
            anomaly_config: {
              anomaly_type: anomalyType,
              parameters: defaultParams,
              probability: 1.0,
            },
          },
        };
      } else if (type === 'control') {
        const nodeTypeInfo = nodeTypesList.find((n) => n.type === nodeType);
        newNode = {
          id: nodeId,
          type: nodeType,
          position,
          data: {
            label: nodeTypeInfo?.name || nodeType,
            config: nodeTypeInfo?.parameters || {},
            delay_seconds: nodeType === 'delay' ? 2 : undefined,
          },
        };
      } else {
        newNode = {
          id: nodeId,
          type: 'output',
          position,
          data: { label: '输出' },
        };
      }

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes, devices, anomalyTypes, nodeTypesList]
  );

  const loadTemplateToCanvas = (template: AnomalyTemplate, startPosition?: { x: number; y: number }) => {
    const wfData = template.workflow_data;
    if (!wfData || !wfData.nodes) return;

    const offsetX = startPosition?.x || 100;
    const offsetY = startPosition?.y || 100;

    const idMap: Record<string, string> = {};
    const newNodes: Node[] = wfData.nodes.map((node) => {
      const newId = uuidv4();
      idMap[node.id] = newId;

      let type = node.type;
      let data: any = {
        label: node.anomaly_config?.anomaly_type || node.type,
        config: node.config || {},
        anomaly_config: node.anomaly_config,
        anomalyType: node.anomaly_config?.anomaly_type,
        deviceId: node.type === 'device' ? node.config.deviceId : undefined,
        delay_seconds: node.delay_seconds,
        parallel_group: node.parallel_group,
      };

      if (type === 'device') {
        const device = devices.find((d) => d.device_id === node.config.deviceId);
        data.label = device?.device_id || '设备';
      } else if (type === 'anomaly') {
        const anomaly = anomalyTypes.find((a) => a.name === node.anomaly_config?.anomaly_type);
        data.label = anomaly?.description || node.anomaly_config?.anomaly_type;
      }

      return {
        id: newId,
        type: type as any,
        position: {
          x: (node.position.x || 0) + offsetX,
          y: (node.position.y || 0) + offsetY,
        },
        data,
      };
    });

    const newEdges: Edge[] = (wfData.edges || []).map((edge) => ({
      id: uuidv4(),
      source: idMap[edge.source] || edge.source,
      target: idMap[edge.target] || edge.target,
      type: 'custom',
      animated: true,
      style: { stroke: '#64748b', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
      data: {
        delay_seconds: edge.delay_seconds,
        condition: edge.condition,
      },
    }));

    setNodes((nds) => [...nds, ...newNodes]);
    setEdges((eds) => [...eds, ...newEdges]);
    message.success(`已加载模板: ${template.name}`);
  };

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setSelectedEdge(null);
    if (node.type === 'anomaly') {
      const config = node.data.anomaly_config || {};
      form.setFieldsValue({
        probability: config.probability || 1.0,
        ...config.parameters,
      });
    } else if (node.type === 'delay') {
      form.setFieldsValue({
        delay_seconds: node.data.delay_seconds || node.data.config?.delay_seconds || 2,
      });
    } else if (node.type === 'condition') {
      form.setFieldsValue({
        expression: node.data.config?.expression || 'temperature > 30',
      });
    } else if (node.type === 'parallel') {
      form.setFieldsValue({
        branch_count: node.data.config?.branch_count || 2,
        parallel_group: node.data.parallel_group || '',
      });
    }
  }, [form]);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  const handleConfigChange = async (_: any, allValues: any) => {
    if (!selectedNode) return;

    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === selectedNode.id) {
          const newData = { ...node.data };

          if (node.type === 'anomaly') {
            const { probability, ...params } = allValues;
            newData.config = { probability };
            newData.anomaly_config = {
              anomaly_type: node.data.anomalyType,
              parameters: params,
              probability,
            };
          } else if (node.type === 'delay') {
            newData.delay_seconds = allValues.delay_seconds;
            newData.config = { delay_seconds: allValues.delay_seconds };
          } else if (node.type === 'condition') {
            newData.config = { expression: allValues.expression };
          } else if (node.type === 'parallel') {
            newData.config = { branch_count: allValues.branch_count };
            newData.parallel_group = allValues.parallel_group;
          }

          return { ...node, data: newData };
        }
        return node;
      })
    );
  };

  const handleEdgeConfigChange = async (_: any, allValues: any) => {
    if (!selectedEdge) return;

    setEdges((eds) =>
      eds.map((edge) => {
        if (edge.id === selectedEdge.id) {
          return {
            ...edge,
            data: {
              ...edge.data,
              delay_seconds: allValues.delay_seconds,
              condition: allValues.condition,
            },
          };
        }
        return edge;
      })
    );
    setSelectedEdge((prev) =>
      prev
        ? {
            ...prev,
            data: {
              ...prev.data,
              delay_seconds: allValues.delay_seconds,
              condition: allValues.condition,
            },
          }
        : null
    );
  };

  const handleDeleteNode = () => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  };

  const handleDeleteEdge = () => {
    if (!selectedEdge) return;
    setEdges((eds) => eds.filter((e) => e.id !== selectedEdge.id));
    setSelectedEdge(null);
  };

  const onDragStart = (
    event: React.DragEvent,
    type: string,
    anomalyType?: string,
    deviceId?: string,
    nodeType?: string,
    template?: AnomalyTemplate
  ) => {
    event.dataTransfer.setData('application/reactflow/type', type);
    if (anomalyType) {
      event.dataTransfer.setData('application/reactflow/anomalyType', anomalyType);
    }
    if (deviceId) {
      event.dataTransfer.setData('application/reactflow/deviceId', deviceId);
    }
    if (nodeType) {
      event.dataTransfer.setData('application/reactflow/nodeType', nodeType);
    }
    if (template) {
      event.dataTransfer.setData('application/reactflow/template', JSON.stringify(template));
    }
    event.dataTransfer.effectAllowed = 'move';
  };

  const buildWorkflow = (): WorkflowType => {
    const workflowNodes: WorkflowNode[] = nodes.map((n) => ({
      id: n.id,
      type: n.type as string,
      position: n.position,
      config: n.data.config || {},
      anomaly_config: n.data.anomaly_config,
      delay_seconds: n.data.delay_seconds,
      parallel_group: n.data.parallel_group,
    }));

    const workflowEdges: WorkflowEdge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      delay_seconds: e.data?.delay_seconds,
      condition: e.data?.condition,
    }));

    return {
      name: workflowName || '未命名工作流',
      description: workflowDesc,
      nodes: workflowNodes,
      edges: workflowEdges,
      device_ids: selectedDevices,
      execution_mode: executionMode,
    };
  };

  const handleSave = async () => {
    if (!workflowName) {
      message.warning('请输入工作流名称');
      setSaveModalVisible(true);
      return;
    }

    try {
      const workflow = buildWorkflow();
      const response = await workflowApi.create(workflow);
      workflow.id = response.data.workflow_id;
      addWorkflowStore(workflow);
      setWorkflows((ws) => [...ws, workflow]);
      message.success('工作流已保存');
      setSaveModalVisible(false);
    } catch (e) {
      console.error('Failed to save workflow:', e);
      message.error('保存失败');
    }
  };

  const handleStart = async (workflowId: string) => {
    try {
      await workflowApi.start(workflowId);
      setIsRunning((prev) => ({ ...prev, [workflowId]: true }));
      message.success('工作流已启动');
    } catch (e) {
      console.error('Failed to start workflow:', e);
      message.error('启动失败');
    }
  };

  const handleStop = async (workflowId: string) => {
    try {
      await workflowApi.stop(workflowId);
      setIsRunning((prev) => ({ ...prev, [workflowId]: false }));
      message.success('工作流已停止');
    } catch (e) {
      console.error('Failed to stop workflow:', e);
      message.error('停止失败');
    }
  };

  const handleDeleteWorkflow = async (workflowId: string) => {
    try {
      await workflowApi.delete(workflowId);
      removeWorkflowStore(workflowId);
      setWorkflows((ws) => ws.filter((w) => w.id !== workflowId));
      message.success('工作流已删除');
    } catch (e) {
      console.error('Failed to delete workflow:', e);
      message.error('删除失败');
    }
  };

  const handleLoadWorkflow = (workflow: WorkflowType) => {
    const loadedNodes: Node[] = workflow.nodes.map((n) => {
      let type = n.type;
      let data: any = {
        label: n.anomaly_config?.anomaly_type || n.type,
        config: n.config,
        anomaly_config: n.anomaly_config,
        anomalyType: n.anomaly_config?.anomaly_type,
        deviceId: n.type === 'device' ? n.config.deviceId : undefined,
        delay_seconds: n.delay_seconds,
        parallel_group: n.parallel_group,
      };

      if (type === 'device') {
        const device = devices.find((d) => d.device_id === n.config.deviceId);
        data.label = device?.device_id || '设备';
      } else if (type === 'anomaly') {
        const anomaly = anomalyTypes.find((a) => a.name === n.anomaly_config?.anomaly_type);
        data.label = anomaly?.description || n.anomaly_config?.anomaly_type;
      }

      return {
        id: n.id,
        type: type as any,
        position: n.position,
        data,
      };
    });

    const loadedEdges: Edge[] = workflow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'custom',
      animated: true,
      style: { stroke: '#64748b', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
      data: {
        delay_seconds: e.delay_seconds,
        condition: e.condition,
      },
    }));

    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setWorkflowName(workflow.name);
    setWorkflowDesc(workflow.description || '');
    setSelectedDevices(workflow.device_ids);
    setExecutionMode(workflow.execution_mode || 'sequential');
    message.info('工作流已加载');
  };

  const handleApplyTemplate = async (template: AnomalyTemplate) => {
    if (selectedDevices.length === 0) {
      message.warning('请先选择目标设备');
      return;
    }

    try {
      await templateApi.apply(template.id!, { device_ids: selectedDevices });
      message.success(`模板 ${template.name} 已应用到设备`);
    } catch (e) {
      console.error('Failed to apply template:', e);
      message.error('应用模板失败');
    }
  };

  const handleSaveAsTestCase = async () => {
    if (!workflowName) {
      message.warning('请先保存工作流');
      return;
    }
    try {
      const workflow = buildWorkflow();
      await testCaseApi.create(workflow, workflowName, workflowDesc);
      message.success('测试用例已保存');
    } catch (e) {
      console.error('Failed to save test case:', e);
      message.error('保存失败');
    }
  };

  const handleClearCanvas = () => {
    setNodes([]);
    setEdges([]);
    setSelectedNode(null);
    setSelectedEdge(null);
    setWorkflowName('');
    setWorkflowDesc('');
  };

  const filteredTemplates = selectedCategory
    ? templates.filter((t) => t.category === selectedCategory)
    : templates;

  const anomalyColorMap: Record<string, string> = {
    packet_loss: 'red',
    out_of_order: 'orange',
    delay: 'gold',
    value_spike: 'magenta',
    timestamp_drift: 'geekblue',
    value_drift: 'purple',
    data_stagnation: 'cyan',
    noise_injection: 'lime',
    timestamp_monotonicity_correction: 'volcano',
    chain_delay: 'gold',
    edge_condition_skipped: 'purple',
  };

  const getCategoryIcon = (category: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      network: <WifiOutlined />,
      sensor: <ThunderboltOutlined />,
      data: <DatabaseOutlined />,
      hardware: <BulbOutlined />,
      custom: <SettingOutlined />,
    };
    return iconMap[category] || <SettingOutlined />;
  };

  return (
    <div className="h-[calc(100vh-280px)] flex gap-4">
      <div className="w-72 flex flex-col gap-4 overflow-y-auto">
        <Card 
          title={
            <Tabs 
              activeKey={activeTab} 
              onChange={(k) => setActiveTab(k as any)}
              size="small"
            >
              <TabPane tab="组件库" key="nodes" />
              <TabPane tab="模板库" key="templates" />
            </Tabs>
          } 
          size="small" 
          className="shrink-0"
        >
          {activeTab === 'nodes' && (
            <Space direction="vertical" className="w-full" size={8}>
              <div className="text-xs text-slate-400 mb-2">设备节点</div>
              {devices.map((device) => (
                <div
                  key={device.device_id}
                  draggable
                  onDragStart={(e) => onDragStart(e, 'device', undefined, device.device_id)}
                  className="flex items-center gap-2 p-2 bg-blue-900/30 border border-blue-700 rounded cursor-move hover:bg-blue-900/50 transition-colors"
                >
                  <ApartmentOutlined className="text-blue-400" />
                  <span className="text-sm">{device.device_id}</span>
                </div>
              ))}
              
              <div className="text-xs text-slate-400 mt-4 mb-2">控制节点</div>
              {nodeTypesList.filter((n) => n.type !== 'anomaly' && n.type !== 'device' && n.type !== 'output').map((nodeType) => (
                <div
                  key={nodeType.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, 'control', undefined, undefined, nodeType.type)}
                  className="flex items-center gap-2 p-2 bg-purple-900/30 border border-purple-700 rounded cursor-move hover:bg-purple-900/50 transition-colors"
                >
                  {nodeType.type === 'delay' && <ClockCircleOutlined className="text-yellow-400" />}
                  {nodeType.type === 'condition' && <QuestionCircleOutlined className="text-purple-400" />}
                  {nodeType.type === 'parallel' && <BranchOutlined className="text-indigo-400" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{nodeType.name}</div>
                    <div className="text-xs text-slate-400">{nodeType.description}</div>
                  </div>
                </div>
              ))}

              <div className="text-xs text-slate-400 mt-4 mb-2">异常节点</div>
              {anomalyTypes.map((anomaly) => (
                <div
                  key={anomaly.name}
                  draggable
                  onDragStart={(e) => onDragStart(e, 'anomaly', anomaly.name)}
                  className="flex items-center gap-2 p-2 bg-slate-700/50 border border-slate-600 rounded cursor-move hover:bg-slate-700 transition-colors"
                >
                  <ThunderboltOutlined 
                    className={anomalyColorMap[anomaly.name] ? `text-${anomalyColorMap[anomaly.name]}-500` : 'text-warning-500'} 
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{anomaly.description}</div>
                    <Tag color={anomalyColorMap[anomaly.name]} className="m-0 text-xs">
                      {anomaly.name}
                    </Tag>
                  </div>
                </div>
              ))}
              
              <div className="text-xs text-slate-400 mt-4 mb-2">输出节点</div>
              <div
                draggable
                onDragStart={(e) => onDragStart(e, 'output')}
                className="flex items-center gap-2 p-2 bg-green-900/30 border border-green-700 rounded cursor-move hover:bg-green-900/50 transition-colors"
              >
                <DatabaseOutlined className="text-green-400" />
                <span className="text-sm">InfluxDB 输出</span>
              </div>
            </Space>
          )}

          {activeTab === 'templates' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1 mb-2">
                <Tag.CheckableTag
                  checked={!selectedCategory}
                  onChange={() => setSelectedCategory(null)}
                >
                  全部
                </Tag.CheckableTag>
                {templateCategories.map((cat) => (
                  <Tag.CheckableTag
                    key={cat.id}
                    checked={selectedCategory === cat.id}
                    onChange={() => setSelectedCategory(cat.id)}
                  >
                    {cat.name}
                  </Tag.CheckableTag>
                ))}
              </div>

              {filteredTemplates.length === 0 ? (
                <Empty description="暂无模板" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                filteredTemplates.map((template) => (
                  <div
                    key={template.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, 'template', undefined, undefined, undefined, template)}
                    className="p-3 bg-slate-700/30 border border-slate-600 rounded cursor-move hover:bg-slate-700/50 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">
                        {getCategoryIcon(template.category)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm flex items-center gap-2">
                          {template.name}
                          {template.is_builtin && (
                            <Tag color="blue" className="m-0 text-xs">内置</Tag>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 line-clamp-2">
                          {template.description}
                        </div>
                        <div className="flex gap-1 mt-2">
                          <Button
                            size="small"
                            type="text"
                            icon={<CopyOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              loadTemplateToCanvas(template);
                            }}
                          >
                            加载
                          </Button>
                          <Button
                            size="small"
                            type="primary"
                            ghost
                            icon={<RocketOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApplyTemplate(template);
                            }}
                          >
                            应用
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </Card>

        <Card title="已保存工作流" size="small">
          <List
            size="small"
            dataSource={workflows}
            renderItem={(workflow) => (
              <List.Item
                actions={[
                  isRunning[workflow.id!] ? (
                    <Button
                      type="text"
                      size="small"
                      icon={<StopOutlined />}
                      onClick={() => handleStop(workflow.id!)}
                      danger
                    />
                  ) : (
                    <Button
                      type="text"
                      size="small"
                      icon={<PlayCircleOutlined />}
                      onClick={() => handleStart(workflow.id!)}
                      type="primary"
                    />
                  ),
                  <Popconfirm
                    title="确定删除此工作流？"
                    onConfirm={() => handleDeleteWorkflow(workflow.id!)}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
                className="cursor-pointer hover:bg-slate-700/30 rounded px-2"
                onClick={() => handleLoadWorkflow(workflow)}
              >
                <List.Item.Meta
                  title={workflow.name}
                  description={
                    <span className="text-xs text-slate-400">
                      {workflow.nodes?.length || 0} 个节点 · {workflow.device_ids?.length || 0} 个设备
                    </span>
                  }
                />
                {isRunning[workflow.id!] && <Tag color="green">运行中</Tag>}
              </List.Item>
            )}
            locale={{ emptyText: '暂无工作流' }}
          />
        </Card>
      </div>

      <div className="flex-1 flex flex-col gap-4">
        <div className="flex gap-4 items-center flex-wrap">
          <Input
            placeholder="工作流名称"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            style={{ width: 200 }}
          />
          <Select
            mode="multiple"
            placeholder="选择目标设备"
            value={selectedDevices}
            onChange={setSelectedDevices}
            style={{ minWidth: 200, flex: 1 }}
          >
            {devices.map((d) => (
              <Option key={d.device_id} value={d.device_id}>
                {d.device_id}
              </Option>
            ))}
          </Select>
          <Select
            value={executionMode}
            onChange={setExecutionMode}
            style={{ width: 140 }}
          >
            <Option value="sequential">顺序执行</Option>
            <Option value="parallel">并行执行</Option>
            <Option value="mixed">混合模式</Option>
          </Select>
          <Space>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => setSaveModalVisible(true)}
            >
              保存
            </Button>
            <Button icon={<DownloadOutlined />} onClick={handleSaveAsTestCase}>
              存为测试用例
            </Button>
            <Button icon={<DeleteOutlined />} onClick={handleClearCanvas} danger>
              清空
            </Button>
          </Space>
        </div>

        <div ref={reactFlowWrapper} className="flex-1 bg-slate-900 rounded-lg border border-slate-700">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            className="bg-slate-900"
            defaultEdgeOptions={{
              type: 'custom',
              animated: true,
              style: { stroke: '#64748b', strokeWidth: 2 },
            }}
          >
            <svg>
              <defs>
                <marker
                  id="arrow"
                  markerWidth="10"
                  markerHeight="10"
                  refX="8"
                  refY="5"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L10,5 L0,10 Z" fill="#64748b" />
                </marker>
              </defs>
            </svg>
            <Background color="#1e293b" gap={16} />
            <Controls />
            <MiniMap
              nodeStrokeColor={(n) => {
                if (n.type === 'device') return '#3b82f6';
                if (n.type === 'output') return '#10b981';
                if (n.type === 'delay') return '#eab308';
                if (n.type === 'condition') return '#a855f7';
                if (n.type === 'parallel') return '#6366f1';
                return '#f59e0b';
              }}
              nodeColor="#1e293b"
              maskColor="#0f172a"
            />
          </ReactFlow>
        </div>
      </div>

      <div className="w-80 shrink-0 overflow-y-auto space-y-4">
        {selectedNode ? (
          <Card
            title={
              <Space>
                <span>节点配置</span>
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={handleDeleteNode}
                />
              </Space>
            }
            size="small"
          >
            <Form
              form={form}
              layout="vertical"
              onValuesChange={handleConfigChange}
              initialValues={{ probability: 1.0 }}
            >
              {selectedNode.type === 'anomaly' && (
                <>
                  <Tag color={anomalyColorMap[selectedNode.data.anomalyType] || 'default'}>
                    {selectedNode.data.anomalyType}
                  </Tag>
                  <Divider className="my-2" />
                  <Form.Item name="probability" label="触发概率">
                    <Slider min={0} max={1} step={0.01} />
                  </Form.Item>
                  {anomalyTypes
                    .find((a) => a.name === selectedNode.data.anomalyType)
                    ?.parameters &&
                    Object.entries(
                      anomalyTypes.find((a) => a.name === selectedNode.data.anomalyType)!.parameters
                    ).map(([key, config]: [string, any]) => (
                      <Form.Item key={key} name={key} label={key}>
                        {config.type === 'float' || config.type === 'int' ? (
                          <Input
                            type="number"
                            step={config.type === 'float' ? 0.01 : 1}
                            min={config.min}
                            max={config.max}
                          />
                        ) : config.type === 'boolean' ? (
                          <Switch />
                        ) : config.type === 'array' ? (
                          <Select mode="multiple" defaultValue={config.default}>
                            {['temperature', 'humidity', 'voltage', 'current', 'pressure'].map((m) => (
                              <Option key={m} value={m}>
                                {m}
                              </Option>
                            ))}
                          </Select>
                        ) : (
                          <Input />
                        )}
                      </Form.Item>
                    ))}
                  <Form.Item name="parallel_group" label="并行组（可选）">
                    <Input placeholder="输入并行组名称" />
                  </Form.Item>
                </>
              )}

              {selectedNode.type === 'delay' && (
                <>
                  <Tag color="gold">延迟节点</Tag>
                  <Divider className="my-2" />
                  <Form.Item name="delay_seconds" label="延迟时间（秒）">
                    <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
                  </Form.Item>
                </>
              )}

              {selectedNode.type === 'condition' && (
                <>
                  <Tag color="purple">条件节点</Tag>
                  <Divider className="my-2" />
                  <Form.Item name="expression" label="条件表达式">
                    <TextArea rows={2} placeholder="例如: temperature > 30" />
                  </Form.Item>
                  <div className="text-xs text-slate-400">
                    可用变量: temperature, humidity, voltage, current, pressure
                  </div>
                </>
              )}

              {selectedNode.type === 'parallel' && (
                <>
                  <Tag color="indigo">并行分支</Tag>
                  <Divider className="my-2" />
                  <Form.Item name="branch_count" label="分支数量">
                    <InputNumber min={2} max={10} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="parallel_group" label="并行组标识">
                    <Input placeholder="用于标识并行组" />
                  </Form.Item>
                </>
              )}

              {selectedNode.type === 'device' && (
                <>
                  <Tag color="blue">设备输入</Tag>
                  <Divider className="my-2" />
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="text-slate-400">设备ID:</span> {selectedNode.data.deviceId}
                    </div>
                  </div>
                </>
              )}

              {selectedNode.type === 'output' && (
                <>
                  <Tag color="green">数据输出</Tag>
                  <Divider className="my-2" />
                  <div className="text-sm text-slate-400">
                    输出数据到 InfluxDB 数据库
                  </div>
                </>
              )}
            </Form>
          </Card>
        ) : selectedEdge ? (
          <Card
            title={
              <Space>
                <span>连线配置</span>
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={handleDeleteEdge}
                />
              </Space>
            }
            size="small"
          >
            <Form
              form={edgeForm}
              layout="vertical"
              onValuesChange={handleEdgeConfigChange}
            >
              <Form.Item name="delay_seconds" label="延迟执行（秒）">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} placeholder="连接后延迟执行下一个节点" />
              </Form.Item>
              <Form.Item name="condition" label="条件表达式（可选）">
                <TextArea rows={2} placeholder="满足条件才执行下一个节点，例如: temperature > 30" />
              </Form.Item>
              <div className="text-xs text-slate-400">
                提示：连线的延迟和条件可以实现复杂的异常编排
              </div>
            </Form>
          </Card>
        ) : (
          <Card title="使用说明" size="small">
            <ul className="text-sm text-slate-400 space-y-2">
              <li>• 从左侧拖拽组件到画布</li>
              <li>• 拖拽模板可快速加载异常组合</li>
              <li>• 连接节点构建异常注入流程</li>
              <li>• 点击连线配置延迟和条件</li>
              <li>• 相同并行组的节点会同时执行</li>
              <li>• 选择目标设备后应用模板</li>
            </ul>
            <Divider className="my-3" />
            <div className="text-sm">
              <div className="font-medium mb-2">异常类型说明：</div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <Tag color="red">丢包</Tag> 随机丢弃数据包
                </div>
                <div className="flex items-center gap-2">
                  <Tag color="orange">乱序</Tag> 数据包乱序到达
                </div>
                <div className="flex items-center gap-2">
                  <Tag color="gold">延迟</Tag> 数据包延迟到达
                </div>
                <div className="flex items-center gap-2">
                  <Tag color="magenta">数值突变</Tag> 数值突然大幅变化
                </div>
                <div className="flex items-center gap-2">
                  <Tag color="geekblue">时间戳漂移</Tag> 时间戳偏移
                </div>
                <div className="flex items-center gap-2">
                  <Tag color="purple">数值漂移</Tag> 数值渐进变化
                </div>
                <div className="flex items-center gap-2">
                  <Tag color="cyan">数据停滞</Tag> 数值保持不变
                </div>
                <div className="flex items-center gap-2">
                  <Tag color="lime">噪声注入</Tag> 添加随机噪声
                </div>
              </div>
            </div>
          </Card>
        )}

        {(selectedNode || selectedEdge) && (
          <Card title="信息" size="small">
            <div className="text-sm space-y-1">
              {selectedNode && (
                <>
                  <div>
                    <span className="text-slate-400">ID:</span> {selectedNode.id}
                  </div>
                  <div>
                    <span className="text-slate-400">类型:</span> {selectedNode.type}
                  </div>
                  <div>
                    <span className="text-slate-400">位置:</span> ({selectedNode.position.x.toFixed(0)}, {selectedNode.position.y.toFixed(0)})
                  </div>
                </>
              )}
              {selectedEdge && (
                <>
                  <div>
                    <span className="text-slate-400">源节点:</span> {selectedEdge.source}
                  </div>
                  <div>
                    <span className="text-slate-400">目标节点:</span> {selectedEdge.target}
                  </div>
                </>
              )}
            </div>
          </Card>
        )}

        <Card title="工作流描述" size="small">
          <TextArea
            rows={4}
            placeholder="输入工作流描述..."
            value={workflowDesc}
            onChange={(e) => setWorkflowDesc(e.target.value)}
          />
        </Card>
      </div>

      <Modal
        title="保存工作流"
        open={saveModalVisible}
        onOk={handleSave}
        onCancel={() => setSaveModalVisible(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form layout="vertical">
          <Form.Item label="工作流名称" required>
            <Input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="请输入工作流名称"
            />
          </Form.Item>
          <Form.Item label="描述">
            <TextArea
              rows={3}
              value={workflowDesc}
              onChange={(e) => setWorkflowDesc(e.target.value)}
              placeholder="请输入工作流描述"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default WorkflowEditor;
