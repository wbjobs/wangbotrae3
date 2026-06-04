package dag

import (
	"errors"
	"sync"
)

type Node struct {
	ID       string
	DependsOn []string
}

type Graph struct {
	nodes map[string]*Node
	mutex sync.RWMutex
}

func NewGraph() *Graph {
	return &Graph{
		nodes: make(map[string]*Node),
	}
}

func (g *Graph) AddNode(id string, dependsOn []string) error {
	g.mutex.Lock()
	defer g.mutex.Unlock()

	if _, exists := g.nodes[id]; exists {
		return errors.New("node already exists")
	}

	g.nodes[id] = &Node{
		ID:       id,
		DependsOn: dependsOn,
	}

	return nil
}

func (g *Graph) RemoveNode(id string) {
	g.mutex.Lock()
	defer g.mutex.Unlock()

	delete(g.nodes, id)

	for _, node := range g.nodes {
		newDeps := make([]string, 0, len(node.DependsOn))
		for _, dep := range node.DependsOn {
			if dep != id {
				newDeps = append(newDeps, dep)
			}
		}
		node.DependsOn = newDeps
	}
}

func (g *Graph) HasCycle() bool {
	g.mutex.RLock()
	defer g.mutex.RUnlock()

	visited := make(map[string]bool)
	recursionStack := make(map[string]bool)

	for id := range g.nodes {
		if g.hasCycleDFS(id, visited, recursionStack) {
			return true
		}
	}

	return false
}

func (g *Graph) hasCycleDFS(id string, visited, recursionStack map[string]bool) bool {
	if recursionStack[id] {
		return true
	}
	if visited[id] {
		return false
	}

	visited[id] = true
	recursionStack[id] = true

	node := g.nodes[id]
	if node != nil {
		for _, dep := range node.DependsOn {
			if g.hasCycleDFS(dep, visited, recursionStack) {
				return true
			}
		}
	}

	recursionStack[id] = false
	return false
}

func (g *Graph) TopologicalSort() ([]string, error) {
	g.mutex.RLock()
	defer g.mutex.RUnlock()

	if g.HasCycle() {
		return nil, errors.New("graph has cycle")
	}

	inDegree := make(map[string]int)
	for id := range g.nodes {
		inDegree[id] = 0
	}

	for _, node := range g.nodes {
		for _, dep := range node.DependsOn {
			if _, exists := g.nodes[dep]; exists {
				inDegree[dep]++
			}
		}
	}

	queue := make([]string, 0)
	for id, degree := range inDegree {
		if degree == 0 {
			queue = append(queue, id)
		}
	}

	result := make([]string, 0, len(g.nodes))
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		result = append(result, id)

		node := g.nodes[id]
		if node != nil {
			for _, dep := range node.DependsOn {
				inDegree[dep]--
				if inDegree[dep] == 0 {
					queue = append(queue, dep)
				}
			}
		}
	}

	if len(result) != len(g.nodes) {
		return nil, errors.New("graph has cycle or missing dependencies")
	}

	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}

	return result, nil
}

func (g *Graph) GetDependencies(id string) []string {
	g.mutex.RLock()
	defer g.mutex.RUnlock()

	node, exists := g.nodes[id]
	if !exists {
		return nil
	}
	return node.DependsOn
}

func (g *Graph) GetDependents(id string) []string {
	g.mutex.RLock()
	defer g.mutex.RUnlock()

	dependents := make([]string, 0)
	for nodeID, node := range g.nodes {
		for _, dep := range node.DependsOn {
			if dep == id {
				dependents = append(dependents, nodeID)
				break
			}
		}
	}
	return dependents
}

func (g *Graph) GetNodes() []string {
	g.mutex.RLock()
	defer g.mutex.RUnlock()

	nodes := make([]string, 0, len(g.nodes))
	for id := range g.nodes {
		nodes = append(nodes, id)
	}
	return nodes
}

func (g *Graph) HasNode(id string) bool {
	g.mutex.RLock()
	defer g.mutex.RUnlock()

	_, exists := g.nodes[id]
	return exists
}
